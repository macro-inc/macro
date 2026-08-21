//! Storage ports for activities.

use std::collections::HashMap;
use std::num::NonZeroU32;

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use uuid::Uuid;

use super::models::{Activity, ActivityRecord};

/// Human-readable metadata for a property referenced by an activity event.
#[cfg(feature = "ai_tools")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityPropertyMetadata {
    /// The property definition's display name.
    pub display_name: String,
    /// The canonical property data type (for example `tag` or `select_string`).
    pub data_type: String,
    /// Select-option ids mapped to their human-readable labels.
    pub option_labels: HashMap<String, String>,
}

/// Resolves user-visible metadata referenced by stored activity payloads.
///
/// Implementations enforce the viewer's property-definition visibility and
/// return only metadata the viewer may read. Resolution is best-effort: an
/// unavailable secondary service returns an empty map so the primary activity
/// read can still succeed.
#[cfg(feature = "ai_tools")]
#[async_trait::async_trait]
pub trait ActivityMetadataResolver: Send + Sync + 'static {
    /// Resolve the requested property definition ids for `viewer`.
    async fn resolve_properties(
        &self,
        viewer: &macro_user_id::user_id::MacroUserIdStr<'_>,
        property_ids: &[String],
    ) -> HashMap<String, ActivityPropertyMetadata>;
}

/// Activity rows grouped per requested entity, newest first within each.
pub type EntityActivityMap = HashMap<(EntityType, String), Vec<ActivityRecord>>;

/// One keyset page of a subject's activity.
#[derive(Debug, Clone, PartialEq)]
pub struct ActivityFeedPage {
    /// Decoded rows, newest first. May be shorter than the requested limit
    /// when corrupt rows were skipped; `next` still advances past them.
    pub records: Vec<ActivityRecord>,
    /// Keyset position to resume after; `None` when the feed is exhausted.
    /// Derived from the raw fetched rows *before* decode-skipping, so one
    /// bad row can never end pagination early.
    pub next: Option<(DateTime<Utc>, Uuid)>,
}

/// A bounded time-range read of one subject's activity.
#[derive(Debug, Clone, PartialEq)]
pub struct ActivityRange {
    /// Decoded rows in the requested range, newest first.
    pub records: Vec<ActivityRecord>,
    /// Whether more matching raw rows existed beyond the requested limit.
    pub truncated: bool,
}

/// Persists activities.
pub trait ActivityRepo {
    /// The adapter's error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Inserts activities idempotently: an activity whose id already exists is left
    /// untouched, so at-least-once redelivery is safe.
    fn insert_activities(
        &self,
        activities: &[Activity],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Hard-deletes every activity for the purged entities.
    fn purge_entities(
        &self,
        entities: &[(EntityType, String)],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Reads activities. Rows come back newest-first (`occurred_at DESC, id
/// DESC` — the stored keyset order), decoded forward-tolerantly: rows whose
/// action this reader doesn't know surface as
/// [`RecordedAction::Unknown`](super::models::RecordedAction::Unknown), and
/// rows too corrupt to represent (unparseable actor or entity type) are
/// skipped, not errors.
pub trait ActivityReads {
    /// The adapter's error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// One page of a subject's activity, newest first. `cursor` is the
    /// `(occurred_at, id)` returned as the previous page's
    /// [`next`](ActivityFeedPage::next); rows strictly before it (in keyset
    /// order) are returned. `limit` is non-zero by type: a zero-row page
    /// could not carry a `next` position and would misreport an exhausted
    /// feed.
    fn subject_feed(
        &self,
        subject_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> impl Future<Output = Result<ActivityFeedPage, Self::Err>> + Send;

    /// The newest `per_entity_limit` activities for each requested entity,
    /// in one round trip. Entities with no activity are absent from the map.
    fn entity_activity(
        &self,
        keys: &[(EntityType, String)],
        per_entity_limit: u32,
    ) -> impl Future<Output = Result<EntityActivityMap, Self::Err>> + Send;

    /// The subject's activity in the half-open interval `[from, to)`, newest
    /// first, capped at `limit`. `truncated` reports whether more matching raw
    /// rows exist, so callers can disclose that the bounded result is partial.
    fn subject_activity_range(
        &self,
        subject_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        limit: NonZeroU32,
    ) -> impl Future<Output = Result<ActivityRange, Self::Err>> + Send;
}
