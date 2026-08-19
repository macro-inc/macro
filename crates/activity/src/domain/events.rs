//! Broker event models for realtime activity delivery.
//!
//! Published by the materializing consumer after rows are durably inserted,
//! addressed (and keyed) per recipient so every subscriber pod can route a
//! message to its own user-scoped broadcast without re-deriving recipients.
//! Recipients are resolved at publish time: the acting subject plus everyone
//! with current access to the touched entities. The wire row stores the
//! action as its two stored columns (tag + payload), so readers decode with
//! the same forward tolerance as reads from Postgres.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroActivityTopic;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::models::{Activity, ActivityRecord, Actor, RecordedAction};

/// One activity row on the wire — the realtime projection of an inserted
/// `activity_events` row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActivityWireRow {
    /// The stored activity id.
    pub id: Uuid,
    /// Who mechanically acted, as a principal string (`macro|…` / `bot|…`).
    pub actor_id: String,
    /// Whose activity this is (a principal string).
    pub subject_id: String,
    /// The kind of entity acted on.
    pub entity_type: EntityType,
    /// The entity acted on.
    pub entity_id: String,
    /// The stored action tag.
    pub action: String,
    /// The stored action payload, if any.
    pub action_payload: Option<Value>,
    /// When it happened.
    pub occurred_at: DateTime<Utc>,
}

impl ActivityWireRow {
    /// Projects an activity onto the wire using the stored column encoding.
    pub fn from_activity(activity: &Activity) -> Self {
        let (action, action_payload) = activity.action.to_columns();
        Self {
            id: activity.id,
            actor_id: activity.actor.as_ref().to_owned(),
            subject_id: activity.subject_id.clone(),
            entity_type: activity.entity_type,
            entity_id: activity.entity_id.clone(),
            action: action.to_owned(),
            action_payload,
            occurred_at: activity.occurred_at,
        }
    }

    /// Decodes into the read-side record, forward-tolerantly for the action.
    /// Returns `None` when the row is too corrupt to represent (unparseable
    /// actor) — the same skip semantics as reads from storage.
    pub fn into_record(self) -> Option<ActivityRecord> {
        let actor = Actor::try_from(self.actor_id).ok()?;
        let (action, _decode_error) =
            RecordedAction::from_columns(self.action, self.action_payload);
        Some(ActivityRecord {
            id: self.id,
            actor,
            subject_id: self.subject_id,
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            action,
            occurred_at: self.occurred_at,
        })
    }
}

/// Events published to [`MacroActivityTopic`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ActivityTopicEvent {
    /// Activities were durably recorded; addressed to one recipient.
    #[serde(rename = "activity.recorded")]
    Recorded {
        /// The user this delivery is addressed to (a `macro|…` principal).
        /// Not necessarily any row's subject: entity watchers receive other
        /// principals' rows.
        recipient_id: String,
        /// The recorded rows this recipient may see.
        activities: Vec<ActivityWireRow>,
    },
}

impl TopicEvent for ActivityTopicEvent {
    type Topic = MacroActivityTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable realtime activity event, keyed by its recipient.
pub struct ActivityMacroEvent {
    key: String,
    event: Event<ActivityTopicEvent>,
}

impl ActivityMacroEvent {
    /// Creates an event addressed to one recipient, keyed by that recipient
    /// so a user's updates preserve publish order.
    pub fn recorded(recipient_id: impl Into<String>, activities: Vec<ActivityWireRow>) -> Self {
        let recipient_id = recipient_id.into();
        Self {
            key: recipient_id.clone(),
            event: Event::new(ActivityTopicEvent::Recorded {
                recipient_id,
                activities,
            }),
        }
    }

    /// Returns the topic event carried by this event.
    pub fn into_topic_event(self) -> ActivityTopicEvent {
        self.event.event
    }
}

impl MacroEvent for ActivityMacroEvent {
    type EventPayload = ActivityTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}
