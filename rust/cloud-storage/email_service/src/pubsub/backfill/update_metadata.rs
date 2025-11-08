use crate::pubsub::context::PubSubContext;
use crate::util::backfill::backfill_insights::backfill_email_insights;
use model::insight_context::email_insights::BackfillEmailInsightsFilter;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillPubsubMessage, UpdateMetadataPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailThreadMessage;

/// This step is invoked by BackfillMessage once all messages in a thread have been backfilled.
/// Updates the thread metadata in the database, the replying_to_id values of its messages, and
/// notifies dependencies of a new thread being backfilled. If it's the last thread to be processed,
/// it sets the backfill job status to complete.
#[tracing::instrument(skip(ctx))]
pub async fn update_thread_metadata(
    ctx: &PubSubContext,
    data: &BackfillPubsubMessage,
    link: &link::Link,
    p: &UpdateMetadataPayload,
) -> Result<(), ProcessingError> {
    let mut tx = ctx.db.begin().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e)
                .context("Failed to create transaction for update metadata"),
        })
    })?;

    let result = async {
        // update the metadata for the thread, as all the messages have been backfilled if we
        // get to this point.
        email_db_client::threads::update::update_thread_metadata(&mut tx, p.thread_db_id, link.id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update thread metadata"),
                })
            })?;

        // update the replying_to_id of the messages in the thread. this can only be done once all
        // messages in the thread have been inserted, and we know this is the case by the time we
        // are at the update_thread_metadata BackfillOperation.
        email_db_client::messages::replying_to_id::update_thread_messages_replying_to(
            &mut tx,
            p.thread_db_id,
            link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to update message replying to id"),
            })
        })?;

        // update job status to complete and get back counters to update the job with
        let thread_counters = email_db_client::backfill::thread::update_backfill_thread_success(
            &mut *tx,
            data.job_id,
            &p.thread_provider_id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to update thread status to complete"),
            })
        })?;

        // notify search-service about the new thread
        let search_message = SearchQueueMessage::ExtractEmailThreadMessage(EmailThreadMessage {
            thread_id: p.thread_db_id.clone().to_string(),
            macro_user_id: link.macro_id.clone(),
        });

        ctx.sqs_client
            .send_message_to_search_event_queue(search_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to send message to search extractor queue"),
                })
            })?;

        // update job counters with thread counters
        let job_counters = email_db_client::backfill::job::update::record_thread_success_in_job(
            &mut *tx,
            data.job_id,
            thread_counters,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to update thread status to complete"),
            })
        })?;

        // if all threads needing backfill have been processed, update job status to complete
        let all_threads_processed =
            job_counters.threads_processed_count >= job_counters.total_threads;

        if all_threads_processed {
            tracing::info!("Backfill complete for job {}", data.job_id);
            email_db_client::backfill::job::update::update_backfill_job_status(
                &mut *tx,
                data.job_id,
                BackfillJobStatus::Complete,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update thread status to complete"),
                })
            })?;

            tracing::info!("Backfilling email insights for user {}", link.macro_id);
            let backfill_email_insights_filter = BackfillEmailInsightsFilter {
                user_ids: Some(vec![link.macro_id.clone()]),
                user_thread_limit: None,
            };

            match backfill_email_insights(
                ctx.sqs_client.clone(),
                &ctx.db,
                backfill_email_insights_filter,
            )
            .await
            {
                Ok(res) => {
                    tracing::info!(
                        "Backfilled email insights for user {} with job ids: {:?}",
                        link.macro_id,
                        res.job_ids
                    );
                }
                Err(e) => {
                    tracing::error!(
                        error = ?e,
                        "Failed to backfill email insights for user {}",
                        link.macro_id
                    );
                }
            }
        }

        Ok(())
    }
    .await;

    if let Err(err) = result {
        if let Err(rollback_err) = tx.rollback().await {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(rollback_err).context(format!(
                    "Transaction failed: {} AND rollback also failed",
                    err
                )),
            }));
        }
        return Err(err);
    }

    tx.commit().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e)
                .context("Failed to commit transaction for update metadata"),
        })
    })?;

    Ok(())
}
