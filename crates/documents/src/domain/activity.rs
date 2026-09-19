//! What counts as activity in the documents domain.
//!
//! Documents have no entity-exclusive actions yet, so every mapping goes
//! through [`Activity::common`].

#[cfg(test)]
mod test;

use ::activity::{
    Activity, ActivitySource, Actor, Attribution, CommonAction, EntityType, Ingest, event_time,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::DocumentTopicEvent;
use macro_user_id::user_id::MacroUserIdStr;

/// Attribution for `updated` / `deleted` events. Bot receipts publish `actor`;
/// user receipts (and events from before attribution) only `actor_user_id`.
/// `None` when neither is set, e.g. internal callers.
fn mutation_attribution(
    actor: &Option<Actor<'static>>,
    actor_user_id: &Option<MacroUserIdStr<'static>>,
    on_behalf_of: &Option<MacroUserIdStr<'static>>,
) -> Option<Attribution> {
    let actor = actor
        .clone()
        .or_else(|| actor_user_id.clone().map(Actor::new_from_user))?;
    Some(Attribution::new(actor, on_behalf_of.clone()))
}

impl ActivitySource for DocumentTopicEvent {
    /// Maps one `macro.documents` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let single = |attribution: Attribution,
                      action: CommonAction,
                      document_id: &str,
                      occurred_at: DateTime<Utc>| {
            Ingest::Insert(vec![Activity::attributed(
                event_id,
                0,
                attribution,
                EntityType::Document,
                document_id,
                action,
                occurred_at,
            )])
        };

        match self {
            DocumentTopicEvent::Created(metadata) => {
                let actor = metadata
                    .actor
                    .clone()
                    .unwrap_or_else(|| Actor::new_from_user(metadata.owner.clone()));
                single(
                    Attribution::new(actor, metadata.on_behalf_of.clone()),
                    CommonAction::Created,
                    &metadata.document_id,
                    metadata.created_at.unwrap_or_else(|| event_time(event_id)),
                )
            }
            DocumentTopicEvent::Updated(metadata) => {
                match mutation_attribution(
                    &metadata.actor,
                    &metadata.actor_user_id,
                    &metadata.on_behalf_of,
                ) {
                    Some(attribution) => single(
                        attribution,
                        CommonAction::Edited,
                        &metadata.document_id,
                        event_time(event_id),
                    ),
                    None => Ingest::Ignore,
                }
            }
            DocumentTopicEvent::Deleted(metadata) => {
                match mutation_attribution(
                    &metadata.actor,
                    &metadata.actor_user_id,
                    &metadata.on_behalf_of,
                ) {
                    Some(attribution) => single(
                        attribution,
                        CommonAction::Deleted,
                        &metadata.document_id,
                        event_time(event_id),
                    ),
                    None => Ingest::Ignore,
                }
            }
            // The copy is a new document; its creation is the activity.
            DocumentTopicEvent::Copied(metadata) => single(
                Attribution::direct(Actor::new_from_user(metadata.owner.clone())),
                CommonAction::Created,
                &metadata.document_id,
                event_time(event_id),
            ),
            DocumentTopicEvent::Purged(metadata) => {
                Ingest::Purge(vec![(EntityType::Document, metadata.document_id.clone())])
            }
            // Extraction-pipeline noise, not user activity.
            DocumentTopicEvent::ContentUploaded(_) => Ingest::Ignore,
            // Only AI-attributed sessions carry an actor; human-only collab
            // sessions stay unattributed.
            DocumentTopicEvent::SyncContentUpdated(metadata) => match metadata.actor.clone() {
                Some(actor) => single(
                    Attribution::new(actor, metadata.on_behalf_of.clone()),
                    CommonAction::Edited,
                    &metadata.document_id,
                    event_time(event_id),
                ),
                None => Ingest::Ignore,
            },
            // Session lifecycle (first join / last leave), no actor.
            DocumentTopicEvent::Interaction(_) => Ingest::Ignore,
        }
    }
}
