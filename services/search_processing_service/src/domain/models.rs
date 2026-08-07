use chrono::{DateTime, Utc};
use models_properties::EntityType;
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

/// One page of entities whose denormalized properties must be reindexed.
///
/// A page has one entity type so the source parses and validates that type
/// once, while the indexer receives typed work items. `rows_consumed` stays
/// separate from the number of IDs so offset pagination follows source rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertySourcePage {
    /// IDs of the entities to reindex.
    pub entity_ids: Vec<String>,
    /// Property entity type shared by every ID in this page.
    pub entity_type: EntityType,
    /// Number of source rows covered by this page.
    pub rows_consumed: usize,
}

impl PropertySourcePage {
    /// Construct the end-of-source page for an entity type.
    pub fn empty(entity_type: EntityType) -> Self {
        Self {
            entity_ids: Vec::new(),
            entity_type,
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
    #[error("failed reindexing entity properties")]
    Reindex(#[source] anyhow::Error),
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
///
/// `started_after` / `started_before` filter on `call_records.started_at`
/// because the table doesn't carry an updated_at — calls are immutable
/// after creation, so this gives the equivalent "since X" semantics.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CallBackfillRequest {
    pub call_ids: Vec<String>,
    pub started_after: Option<DateTime<Utc>>,
    pub started_before: Option<DateTime<Utc>>,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Keyset (seek-method) pagination cursor for call backfills.
///
/// `get_call_records_for_search_backfill` walks `call_records` in
/// `(started_at ASC, id ASC)` order; the cursor carries the last row's
/// pair so the next page resumes with `WHERE (started_at, id) > cursor`.
/// `None` starts at the beginning.
#[derive(Debug, Clone)]
pub struct CallBackfillCursor {
    pub started_at: DateTime<Utc>,
    pub call_id: uuid::Uuid,
}

/// Chat-message backfill filter. Empty vectors mean "all messages for every
/// chat / every user".
///
/// `updated_after` / `updated_before` filter on `updatedAt`, not `createdAt`,
/// so incremental runs (e.g. "anything changed since X") catch messages that
/// existed before the cutoff but were edited after it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ChatBackfillRequest {
    pub chat_ids: Vec<String>,
    pub user_ids: Vec<String>,
    pub updated_after: Option<DateTime<Utc>>,
    pub updated_before: Option<DateTime<Utc>>,
    pub deletion_filter: DeletionFilter,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Keyset (seek-method) pagination cursor for chat backfills.
///
/// `get_chat_messages_for_search_backfill` walks `"ChatMessage"` in
/// `(updatedAt ASC, id ASC)` order; the cursor carries the last row's
/// pair so the next page resumes with `WHERE (updatedAt, id) > cursor`.
/// `None` starts at the beginning.
#[derive(Debug, Clone)]
pub struct ChatBackfillCursor {
    pub updated_at: DateTime<Utc>,
    pub message_id: String,
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

/// Keyset (seek-method) pagination cursor for document backfills.
///
/// `get_documents_for_search` walks `"Document"` in
/// `(updatedAt ASC, id ASC)` order; the cursor carries the last row's
/// pair so the next page resumes with `WHERE (updatedAt, id) > cursor`.
/// `None` starts at the beginning.
#[derive(Debug, Clone)]
pub struct DocumentBackfillCursor {
    pub updated_at: DateTime<Utc>,
    pub document_id: String,
}

/// Document backfill filter. Every field is additive — all `None` means "every
/// document this service knows about".
///
/// `updated_after` / `updated_before` filter on `updatedAt`, not `createdAt`,
/// so incremental runs (e.g. "anything changed since X") catch documents that
/// existed before the cutoff but were modified after it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DocumentBackfillRequest {
    pub file_types: Option<Vec<String>>,
    pub sub_type: Option<String>,
    pub updated_after: Option<DateTime<Utc>>,
    pub updated_before: Option<DateTime<Utc>>,
    pub deletion_filter: DeletionFilter,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Project backfill filter. All `None` means "every non-deleted project".
///
/// `updated_after` / `updated_before` filter on `updatedAt` so incremental
/// runs (e.g. "anything changed since X") catch projects that existed before
/// the cutoff but were modified after it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ProjectBackfillRequest {
    pub updated_after: Option<DateTime<Utc>>,
    pub updated_before: Option<DateTime<Utc>>,
    /// Override the OpenSearch target index for upserts (e.g. blue/green swap).
    pub index_override: Option<String>,
}

/// Keyset (seek-method) pagination cursor for project backfills.
///
/// `get_projects_for_search_backfill` walks `"Project"` in
/// `(updatedAt ASC, id ASC)` order; the cursor carries the last row's
/// pair so the next page resumes with `WHERE (updatedAt, id) > cursor`.
/// `None` starts at the beginning.
#[derive(Debug, Clone)]
pub struct ProjectBackfillCursor {
    pub updated_at: DateTime<Utc>,
    pub project_id: String,
}

/// Email-thread backfill filter.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct EmailBackfillRequest {
    /// Reindex exactly these threads, ignoring `since`. Pages over the given
    /// ids rather than scanning the table, so a targeted repair costs one
    /// primary-key lookup per page.
    pub thread_ids: Vec<uuid::Uuid>,
    /// Only backfill threads updated at or after this instant.
    pub since: Option<DateTime<Utc>>,
    pub index_override: Option<String>,
    /// Number of thread ids grouped into each SQS batch message. `None` uses
    /// the adapter's default.
    pub batch_size: Option<usize>,
}

/// Property-only backfill: directly reindex every entity of one type that has
/// property rows, refreshing the denormalized `properties` field without
/// re-extracting content. Used after adding the field to an index's mapping.
#[derive(Debug, Clone, Deserialize)]
pub struct PropertiesBackfillRequest {
    /// The property entity type to backfill (e.g. "thread").
    pub entity_type: String,
}
