//! What counts as activity in the projects domain.
//!
//! Projects have no entity-exclusive actions yet, so every mapping goes
//! through [`Activity::common`].

#[cfg(test)]
mod test;

use ::activity::{Activity, ActivitySource, Actor, CommonAction, EntityType, Ingest, event_time};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::ProjectTopicEvent;

impl ActivitySource for ProjectTopicEvent {
    /// Maps one `macro.projects` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let now = || event_time(event_id);
        let single =
            |actor: Actor<'static>, action: CommonAction, project_id: &str, at: DateTime<Utc>| {
                Ingest::Insert(vec![Activity::common(
                    event_id,
                    0,
                    actor,
                    None,
                    EntityType::Project,
                    project_id,
                    action,
                    at,
                )])
            };

        match self {
            ProjectTopicEvent::Created(m) => single(
                Actor::new_from_user(m.owner.clone()),
                CommonAction::Created,
                &m.project_id,
                now(),
            ),
            ProjectTopicEvent::Updated(m) => match &m.actor_user_id {
                Some(actor) => single(
                    Actor::new_from_user(actor.clone()),
                    CommonAction::Edited,
                    &m.project_id,
                    now(),
                ),
                None => Ingest::Ignore,
            },
            // Activity for the root project only; the cascade lists are
            // soft-deleted rows whose activities we keep.
            ProjectTopicEvent::Deleted(m) => match &m.actor_user_id {
                Some(actor) => single(
                    Actor::new_from_user(actor.clone()),
                    CommonAction::Deleted,
                    &m.project_id,
                    now(),
                ),
                None => Ingest::Ignore,
            },
            ProjectTopicEvent::Restored(m) => match &m.actor_user_id {
                Some(actor) => single(
                    Actor::new_from_user(actor.clone()),
                    CommonAction::Edited,
                    &m.project_id,
                    now(),
                ),
                None => Ingest::Ignore,
            },
            // Known window: the cascade's documents/chats produce activities on
            // *other* topics with no cross-topic ordering, so a redelivered
            // pre-purge event can re-insert an activity for a hard-deleted
            // entity after this purge ran. Entity-owned purge events re-purge on
            // their own topic's replays; a periodic reconciliation sweep is the
            // durable fix if the residue ever matters.
            ProjectTopicEvent::PermanentlyDeleted(m) => Ingest::Purge(
                std::iter::once(&m.project_id)
                    .chain(m.purged_project_ids.iter())
                    .map(|id| (EntityType::Project, id.clone()))
                    .chain(
                        m.purged_document_ids
                            .iter()
                            .map(|id| (EntityType::Document, id.clone())),
                    )
                    .chain(
                        m.purged_chat_ids
                            .iter()
                            .map(|id| (EntityType::Chat, id.clone())),
                    )
                    .collect(),
            ),
            // Bulk upload; per-project creation activities would misattribute —
            // the upload flow publishes Created events for contained documents.
            ProjectTopicEvent::Uploaded(_) => Ingest::Ignore,
        }
    }
}
