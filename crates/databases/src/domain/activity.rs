//! What counts as activity in the databases domain: every event maps through
//! `Activity::attributed` with a `CommonAction`.

#[cfg(test)]
mod test;

use ::activity::{
    Activity, ActivitySource, Attribution, CommonAction, EntityType, Ingest, event_time,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::{self, DatabaseTopicEvent};
use super::models::DatabaseId;

impl ActivitySource for DatabaseTopicEvent {
    /// Maps one `macro.databases` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let single = |attribution: Attribution,
                      action: CommonAction,
                      database_id: DatabaseId,
                      occurred_at: DateTime<Utc>| {
            Ingest::Insert(vec![Activity::attributed(
                event_id,
                0,
                attribution,
                EntityType::Database,
                database_id.to_string(),
                action,
                occurred_at,
            )])
        };
        // Internal callers carry no attribution; their writes belong on
        // nobody's feed and are dropped.
        let attributed = |attribution: &Option<events::Attribution>,
                          action: CommonAction,
                          database_id: DatabaseId| match attribution {
            Some(attribution) => single(
                Attribution::new(attribution.actor.clone(), attribution.on_behalf_of.clone()),
                action,
                database_id,
                event_time(event_id),
            ),
            None => Ingest::Ignore,
        };

        match self {
            DatabaseTopicEvent::Created(metadata) => single(
                Attribution::new(
                    metadata.attribution.actor.clone(),
                    metadata.attribution.on_behalf_of.clone(),
                ),
                CommonAction::Created,
                metadata.database_id,
                metadata.created_at,
            ),
            DatabaseTopicEvent::Renamed(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                metadata.database_id,
            ),
            DatabaseTopicEvent::Trashed(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Deleted,
                metadata.database_id,
            ),
            // Coming back from the trash is a change to the database, not a
            // second creation.
            DatabaseTopicEvent::Restored(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                metadata.database_id,
            ),
            DatabaseTopicEvent::TablesChanged(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                metadata.database_id,
            ),
            DatabaseTopicEvent::SharingChanged(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                metadata.database_id,
            ),
            DatabaseTopicEvent::Purged(metadata) => Ingest::Purge(vec![(
                EntityType::Database,
                metadata.database_id.to_string(),
            )]),
        }
    }
}
