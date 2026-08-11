//! Storage ports for activities.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use uuid::Uuid;

use super::models::{Activity, ActivityRecord};

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
    /// `(occurred_at, id)` of the last row of the previous page; rows
    /// strictly before it (in keyset order) are returned.
    fn subject_feed(
        &self,
        subject_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<ActivityRecord>, Self::Err>> + Send;

    /// The newest `per_entity_limit` activities for each requested entity,
    /// in one round trip. Entities with no activity are absent from the map.
    fn entity_activity(
        &self,
        keys: &[(EntityType, String)],
        per_entity_limit: u32,
    ) -> impl Future<Output = Result<HashMap<(EntityType, String), Vec<ActivityRecord>>, Self::Err>> + Send;
}
