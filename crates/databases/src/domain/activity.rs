//! What counts as activity in the databases domain.
//!
//! Databases have no entity-exclusive actions, so every mapping goes through
//! [`Activity::attributed`] with a [`CommonAction`].

#[cfg(test)]
mod test;

use ::activity::{
    Activity, ActivitySource, Actor, Attribution, CommonAction, EntityType, Ingest, event_time,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::{self, DatabaseTopicEvent};

impl ActivitySource for DatabaseTopicEvent {
    /// Maps one `macro.databases` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let single = |attribution: Attribution,
                      action: CommonAction,
                      database_id: &str,
                      occurred_at: DateTime<Utc>| {
            Ingest::Insert(vec![Activity::attributed(
                event_id,
                0,
                attribution,
                EntityType::Database,
                database_id,
                action,
                occurred_at,
            )])
        };
        // Internal callers carry no attribution; their writes belong on
        // nobody's feed and are dropped.
        let attributed = |attribution: &Option<events::Attribution>,
                          action: CommonAction,
                          database_id: &str| match attribution {
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
                Attribution::direct(Actor::new_from_user(metadata.owner.clone())),
                CommonAction::Created,
                &metadata.database_id,
                metadata.created_at,
            ),
            DatabaseTopicEvent::Renamed(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                &metadata.database_id,
            ),
            DatabaseTopicEvent::Trashed(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Deleted,
                &metadata.database_id,
            ),
            // Coming back from the trash is a change to the database, not a
            // second creation.
            DatabaseTopicEvent::Restored(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                &metadata.database_id,
            ),
            DatabaseTopicEvent::TablesChanged(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                &metadata.database_id,
            ),
            DatabaseTopicEvent::Purged(metadata) => {
                Ingest::Purge(vec![(EntityType::Database, metadata.database_id.clone())])
            }
        }
    }
}
