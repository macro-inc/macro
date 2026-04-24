use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Reply returned by every backfill port.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct BackfillReceipt {
    /// Total number of search-event messages placed on the queue.
    pub enqueued: usize,
}

#[derive(Debug, Error)]
pub enum BackfillError {
    #[error("failed reading backfill source: {0}")]
    Source(#[source] anyhow::Error),
    #[error("failed publishing to search event queue: {0}")]
    Publish(#[source] anyhow::Error),
}

/// Call-record backfill filter. Empty `call_ids` means "all archived calls".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CallBackfillRequest {
    pub call_ids: Vec<String>,
}

/// Chat-message backfill filter. Empty vectors mean "all messages for every
/// chat / every user".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ChatBackfillRequest {
    pub chat_ids: Vec<String>,
    pub user_ids: Vec<String>,
}

/// Channel-message backfill filter. No scoping knobs yet — reserved so adding
/// one later doesn't break the request shape.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ChannelBackfillRequest {}

/// Document backfill filter. Every field is additive — all `None` means "every
/// document this service knows about".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DocumentBackfillRequest {
    pub file_types: Option<Vec<String>>,
    pub sub_type: Option<String>,
    pub created_after: Option<DateTime<Utc>>,
    pub created_before: Option<DateTime<Utc>>,
}

/// Email-thread backfill filter.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct EmailBackfillRequest {
    /// Only backfill threads updated at or after this instant.
    pub since: Option<DateTime<Utc>>,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
    /// Number of thread ids grouped into each SQS batch message. `None` uses
    /// the adapter's default.
    pub batch_size: Option<usize>,
}
