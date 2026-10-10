use models_email::gmail::inbox_sync::{
    GmailMessagePayload, InboxSyncOperation, InboxSyncPubsubMessage,
};
use models_email::service::pubsub::{DetailedError, FailureReason};
use tracing::Level;
use uuid::Uuid;

use super::log_non_retryable_error;
use crate::pubsub::log_capture::LevelLog;

fn most_severe_level_logged(reason: FailureReason) -> Option<Level> {
    let (levels, _guard) = LevelLog::capture();
    let data = InboxSyncPubsubMessage {
        link_id: Uuid::nil(),
        operation: InboxSyncOperation::GmailMessage(GmailMessagePayload { history_id: 1 }),
    };

    log_non_retryable_error(
        &data,
        &DetailedError {
            reason,
            source: anyhow::anyhow!("operation failed"),
        },
    );

    levels.most_severe()
}

#[test]
fn only_rate_limited_deletions_log_below_error() {
    for (reason, expected) in [
        (FailureReason::GmailApiRateLimited, Level::DEBUG),
        (FailureReason::GmailApiFailed, Level::ERROR),
        (FailureReason::AccessTokenFetchFailed, Level::ERROR),
    ] {
        assert_eq!(most_severe_level_logged(reason), Some(expected), "{reason}");
    }
}
