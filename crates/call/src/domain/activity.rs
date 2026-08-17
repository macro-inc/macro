//! What counts as activity in the calls domain.
//!
//! Note the ownership shape: "a call started in this channel" is *call*
//! knowledge even though the activity targets a channel entity — so the
//! call crate owns the [`DomainActivity`] impl targeting
//! [`EntityType::Channel`]. Ownership follows the knowledge, not the entity
//! kind.

#[cfg(test)]
mod test;

use ::activity::{
    Action, Activity, ActivitySource, Actor, CallStart, CommonAction, DomainActivity, EntityType,
    Ingest,
};
use uuid::Uuid;

use super::events::CallTopicEvent;

/// A call started in a channel — a channel-targeted activity owned by the
/// calls domain.
#[derive(Debug, Clone, PartialEq)]
pub struct CallStartedActivity {
    /// The channel the call started in.
    pub channel_id: String,
    /// The started call.
    pub call_id: String,
}

impl DomainActivity for CallStartedActivity {
    const ENTITY_TYPE: EntityType = EntityType::Channel;

    fn entity_id(&self) -> &str {
        &self.channel_id
    }

    fn into_action(self) -> Action {
        Action::CallStarted(CallStart {
            call_id: self.call_id,
        })
    }
}

impl ActivitySource for CallTopicEvent {
    /// Maps one `macro.calls` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        match self {
            // Two activities: the call happened in the channel (timeline/feed),
            // and the call itself is a new entity (soup item).
            CallTopicEvent::Started(m) => {
                let actor = Actor::new_from_user(m.created_by.clone());
                Ingest::Insert(vec![
                    Activity::from_domain(
                        event_id,
                        0,
                        actor.clone(),
                        None,
                        CallStartedActivity {
                            channel_id: m.channel_id.to_string(),
                            call_id: m.call_id.to_string(),
                        },
                        m.created_at,
                    ),
                    Activity::common(
                        event_id,
                        1,
                        actor,
                        None,
                        EntityType::Call,
                        m.call_id.to_string(),
                        CommonAction::Created,
                        m.created_at,
                    ),
                ])
            }
            // Call-record deletion is a hard delete; purge the call's
            // activities like other hard deletes.
            CallTopicEvent::RecordDeleted(m) => {
                Ingest::Purge(vec![(EntityType::Call, m.call_id.to_string())])
            }
            // Archival/processing pipeline, not user activity.
            CallTopicEvent::RecordArchived(_)
            | CallTopicEvent::RecordUpdated(_)
            | CallTopicEvent::RecordSummarized(_)
            | CallTopicEvent::RecordingReady(_) => Ingest::Ignore,
        }
    }
}
