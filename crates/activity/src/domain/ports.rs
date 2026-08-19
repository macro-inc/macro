//! Storage ports for activities.

use std::collections::HashMap;
use std::num::NonZeroU32;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::models::{Activity, ActivityRecord};

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

/// Announces durably recorded activities to realtime subscribers.
///
/// Fire-and-forget: implementations log failures instead of returning them,
/// because delivery is best-effort by design — a missed push is recovered by
/// the source event replaying (uncommitted offset) or by the client's next
/// fetch, and the write path must not fail on announcement problems.
pub trait ActivityRealtimePublisher: Send + Sync {
    /// Announces recorded activities, grouped per subject by the adapter.
    fn publish_recorded(&self, activities: &[Activity]) -> impl Future<Output = ()> + Send;
}

/// Resolves who may currently see an entity's activity.
///
/// Used at publish time to widen realtime delivery beyond the acting
/// subject: entity timelines are watched by everyone with access to the
/// entity, not only whoever acted.
pub trait ActivityAudienceExpander: Send + Sync {
    /// The adapter's error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Returns all users with current access to the entity.
    fn entity_audience(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Self::Err>> + Send;
}

/// Expander reporting an empty audience: delivery to the subject only.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpActivityAudienceExpander;

impl ActivityAudienceExpander for NoOpActivityAudienceExpander {
    type Err = std::convert::Infallible;

    async fn entity_audience(
        &self,
        _entity_type: EntityType,
        _entity_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        Ok(Vec::new())
    }
}

/// Publisher that announces nothing.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpActivityRealtimePublisher;

impl ActivityRealtimePublisher for NoOpActivityRealtimePublisher {
    async fn publish_recorded(&self, _activities: &[Activity]) {}
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
}
