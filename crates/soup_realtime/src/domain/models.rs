//! Realtime Soup patch and broker event models.

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroSoupRealtimeTopic;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use serde::{Deserialize, Serialize};

/// A change to one value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum Patch<T> {
    /// The value was created or updated.
    #[serde(rename = "soup.updated")]
    Updated(T),
    /// The value was deleted.
    #[serde(rename = "soup.deleted")]
    Deleted(T),
}

impl<T> Patch<T> {
    /// Maps the value carried by this patch while preserving its operation.
    pub fn map<U>(self, map: impl FnOnce(T) -> U) -> Patch<U> {
        match self {
            Self::Updated(value) => Patch::Updated(map(value)),
            Self::Deleted(value) => Patch::Deleted(map(value)),
        }
    }

    /// Returns the value carried by this patch.
    pub fn value(&self) -> &T {
        match self {
            Self::Updated(value) | Self::Deleted(value) => value,
        }
    }
}

/// A patch paired with the entity used to resolve its recipients.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoupRealtimePatch {
    /// Patch delivered to each recipient.
    pub patch: Patch<Entity<'static>>,
    /// Entity whose current accessors should receive the patch.
    pub access_source: Entity<'static>,
}

impl SoupRealtimePatch {
    /// Creates a patch with an explicit recipient access source.
    pub fn new(patch: Patch<Entity<'static>>, access_source: Entity<'static>) -> Self {
        Self {
            patch,
            access_source,
        }
    }

    /// Creates a patch whose entity also determines its recipients.
    pub fn for_entity(patch: Patch<Entity<'static>>) -> Self {
        let access_source = patch.value().clone();
        Self::new(patch, access_source)
    }
}

/// One recipient-targeted patch after decoding the Soup topic event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoupRealtimeMessage {
    /// User to whom the patch is addressed.
    pub user_id: MacroUserIdStr<'static>,
    /// Entity patch addressed to the user.
    pub patch: Patch<Entity<'static>>,
}

impl SoupRealtimeMessage {
    /// Creates a patch addressed to a recipient.
    pub fn new(user_id: MacroUserIdStr<'static>, patch: Patch<Entity<'static>>) -> Self {
        Self { user_id, patch }
    }
}

/// Wire payload for [`MacroSoupRealtimeTopic`].
///
/// The recipient is included in the patch payload and repeated as the Kafka
/// key so consumers can route without hydrating a Soup item.
pub type SoupTopicEvent = Patch<(MacroUserIdStr<'static>, Entity<'static>)>;

impl TopicEvent for SoupTopicEvent {
    type Topic = MacroSoupRealtimeTopic;

    const SCHEMA_VERSION: u8 = 2;
}

/// Publishable realtime Soup event keyed by recipient user ID.
pub struct SoupMacroEvent {
    key: String,
    event: Event<SoupTopicEvent>,
}

impl SoupMacroEvent {
    /// Creates a recipient-keyed patch event.
    pub fn from_message(message: SoupRealtimeMessage) -> Self {
        let SoupRealtimeMessage { user_id, patch } = message;
        let key = user_id.as_ref().to_string();
        let event = patch.map(|entity| (user_id, entity));
        Self::with_event(key, Event::new(event))
    }

    /// Builds an event from its Kafka key and pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<SoupTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }

    /// Returns the recipient and entity patch carried by this event.
    pub fn into_message(self) -> SoupRealtimeMessage {
        match self.event.event {
            Patch::Updated((user_id, entity)) => {
                SoupRealtimeMessage::new(user_id, Patch::Updated(entity))
            }
            Patch::Deleted((user_id, entity)) => {
                SoupRealtimeMessage::new(user_id, Patch::Deleted(entity))
            }
        }
    }
}

impl MacroEvent for SoupMacroEvent {
    type EventPayload = SoupTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
