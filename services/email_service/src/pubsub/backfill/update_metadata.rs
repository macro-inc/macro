use crate::pubsub::backfill::db_error::map_db_error;
use crate::pubsub::backfill::increment_counters::incr_completed_threads;
use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::publish_email_event;
use email::domain::events::{EmailMacroEvent, ThreadBackfilledMetadata};
use models_email::email::service::backfill::{JobScopedPayload, UpdateMetadataPayload};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// This step is invoked by BackfillMessage once all messages in a thread have been backfilled.
/// Updates the thread metadata in the database, the replying_to_id values of its messages, and
/// notifies dependencies of a new thread being backfilled. If it's the last thread to be processed,
/// it sets the backfill job status to complete.
#[tracing::instrument(skip(ctx))]
pub async fn update_thread_metadata(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<UpdateMetadataPayload>,
    link: &link::Link,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;
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
            .map_err(|e| map_db_error(e, "Failed to update thread metadata"))?;

        // update the replying_to_id of the messages in the thread. this can only be done once all
        // messages in the thread have been inserted, and we know this is the case by the time we
        // are at the update_thread_metadata BackfillOperation.
        email_db_client::messages::replying_to_id::update_thread_messages_replying_to(
            &mut tx,
            p.thread_db_id,
            link.id,
        )
        .await
        .map_err(|e| map_db_error(e, "Failed to update message replying to id"))?;

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

    incr_completed_threads(ctx, link, scope.job_id).await?;

    // Best-effort by design: publication failures are logged and dropped so a committed
    // backfill is not retried after its completed-thread counters have advanced.
    publish_email_event(
        &ctx.macro_event_broker,
        &EmailMacroEvent::thread_backfilled(ThreadBackfilledMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            thread_id: p.thread_db_id,
        }),
    );

    Ok(())
}
