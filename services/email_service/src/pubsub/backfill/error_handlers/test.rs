use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, BackfillThreadPayload, JobScopedPayload,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason};
use tracing::Level;
use uuid::Uuid;

use super::handle_retryable_error;
use crate::pubsub::log_capture::LevelCapture;

async fn most_severe_level_logged(reason: FailureReason) -> Option<Level> {
    let data = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::BackfillThread(JobScopedPayload {
            link_id: Uuid::nil(),
            job_id: Uuid::nil(),
            payload: BackfillThreadPayload {
                thread_provider_id: "thread".to_string(),
                refresh_existing: false,
            },
        }),
    };
    let capture = LevelCapture::start();

    handle_retryable_error(
        &data,
        &DetailedError {
            reason,
            source: anyhow::anyhow!("operation failed"),
        },
    )
    .await
    .unwrap();

    capture.most_severe()
}

#[tokio::test]
async fn only_rate_limited_retries_log_below_warn() {
    for (reason, expected) in [
        (FailureReason::GmailApiRateLimited, Level::DEBUG),
        (FailureReason::GmailApiFailed, Level::WARN),
        (FailureReason::DatabaseQueryFailed, Level::WARN),
    ] {
        assert_eq!(
            most_severe_level_logged(reason).await,
            Some(expected),
            "{reason}"
        );
    }
}
