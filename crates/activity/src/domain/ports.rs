//! Storage port for activities.

use model_entity::EntityType;

use super::models::Activity;

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
