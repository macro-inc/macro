use crate::pubsub::context::PubSubContext;
use crate::util::backfill::backfill_insights::backfill_email_insights;
use model::insight_context::email_insights::BackfillEmailInsightsFilter;
use models_email::service::backfill::BackfillJobStatus;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

// called when a thread has completed processing. checks if it is the last thread to be processed
// for the job, and if so, performs the necessary actions for job completion.
#[tracing::instrument(skip(ctx))]
pub async fn check_for_job_completion(
    ctx: &PubSubContext,
    macro_id: &str,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    let all_threads_processed = ctx
        .redis_client
        .handle_completed_thread(job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context("Failed to increment completed thread count"),
            })
        })?;

    if all_threads_processed {
        tracing::info!("Backfill complete for job {}", job_id);
        email_db_client::backfill::job::update::update_backfill_job_status(
            &ctx.db,
            job_id,
            BackfillJobStatus::Complete,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to update thread status to complete"),
            })
        })?;

        tracing::info!("Backfilling email insights for user {}", macro_id);
        let backfill_email_insights_filter = BackfillEmailInsightsFilter {
            user_ids: Some(vec![macro_id.to_string()]),
            user_thread_limit: None,
        };

        let backfill_res = backfill_email_insights(
            ctx.sqs_client.clone(),
            &ctx.db,
            backfill_email_insights_filter,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to backfill email insights"),
            })
        })?;

        tracing::info!(
            "Backfilled email insights for user {} with job ids: {:?}",
            macro_id,
            backfill_res.job_ids
        );
    }

    Ok(())
}
