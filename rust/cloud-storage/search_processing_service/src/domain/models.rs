use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqs_client::search::SearchQueueMessage;
use thiserror::Error;

/// Reply returned by every backfill port.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct BackfillReceipt {
    /// Total number of source rows the backfill processed.
    pub enqueued: usize,
}

/// One page of work produced by a [`super::ports`] source. Holding the
/// messages and `rows_consumed` together lets the orchestrator advance its
/// offset by the number of *rows* the source consumed even when the source
/// batches many rows into fewer SQS messages (see the email source).
pub struct SourcePage {
    pub messages: Vec<SearchQueueMessage>,
    /// Number of source rows the page covered. Drives the orchestrator's
    /// `offset += rows_consumed` and its termination check (`rows_consumed
    /// == 0` means the source is exhausted).
    pub rows_consumed: usize,
}

impl SourcePage {
    pub fn empty() -> Self {
        Self {
            messages: Vec::new(),
            rows_consumed: 0,
        }
    }
}

#[derive(Debug, Error)]
pub enum BackfillError {
    #[error("failed reading backfill source")]
    Source(#[source] anyhow::Error),
    #[error("failed publishing to search event queue")]
    Publish(#[source] anyhow::Error),
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeletionFilter {
    #[default]
    Any,
    Active,
    Deleted,
}

impl DeletionFilter {
    pub fn as_only_deleted(self) -> Option<bool> {
        match self {
            DeletionFilter::Any => None,
            DeletionFilter::Active => Some(false),
            DeletionFilter::Deleted => Some(true),
        }
    }
}

/// Call-record backfill filter. Empty `call_ids` means "all archived calls".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CallBackfillRequest {
    pub call_ids: Vec<String>,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Chat-message backfill filter. Empty vectors mean "all messages for every
/// chat / every user".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ChatBackfillRequest {
    pub chat_ids: Vec<String>,
    pub user_ids: Vec<String>,
    pub deletion_filter: DeletionFilter,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Channel-message backfill filter. No scoping knobs yet — reserved so adding
/// one later doesn't break the request shape.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ChannelBackfillRequest {
    pub deletion_filter: DeletionFilter,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Document backfill filter. Every field is additive — all `None` means "every
/// document this service knows about".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DocumentBackfillRequest {
    pub file_types: Option<Vec<String>>,
    pub sub_type: Option<String>,
    pub created_after: Option<DateTime<Utc>>,
    pub created_before: Option<DateTime<Utc>>,
    pub deletion_filter: DeletionFilter,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Email-thread backfill filter.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct EmailBackfillRequest {
    /// Only backfill threads updated at or after this instant.
    pub since: Option<DateTime<Utc>>,
    pub index_override: Option<String>,
    /// Number of thread ids grouped into each SQS batch message. `None` uses
    /// the adapter's default.
    pub batch_size: Option<usize>,
}
