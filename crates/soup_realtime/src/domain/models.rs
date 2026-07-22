//! Realtime Soup message and broker event models.

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroSoupRealtimeTopic;
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::item::SoupItem;
use serde::{Deserialize, Serialize};

/// One full Soup item addressed to a recipient for realtime delivery.
#[derive(Debug, Serialize, Deserialize)]
pub struct SoupRealtimeMessage {
    /// User to whom the Soup item is addressed.
    pub user_id: MacroUserIdStr<'static>,
    /// Complete Soup item with transient user-specific fields normalized.
    pub item: SoupItem<()>,
}

impl SoupRealtimeMessage {
    /// Creates a message addressed to a recipient.
    pub fn new(user_id: MacroUserIdStr<'static>, item: SoupItem<()>) -> Self {
        Self { user_id, item }
    }
}

/// Events published to [`MacroSoupRealtimeTopic`].
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum SoupTopicEvent {
    /// A complete Soup item changed and should be delivered to its recipient.
    #[serde(rename = "soup.item.updated")]
    ItemUpdated(SoupRealtimeMessage),
}

impl TopicEvent for SoupTopicEvent {
    type Topic = MacroSoupRealtimeTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

/// Publishable realtime Soup event keyed by recipient user ID.
pub struct SoupMacroEvent {
    key: String,
    event: Event<SoupTopicEvent>,
}

impl SoupMacroEvent {
    /// Creates a recipient-keyed item update event.
    pub fn item_updated(message: SoupRealtimeMessage) -> Self {
        let key = message.user_id.as_ref().to_string();
        Self::with_event(key, Event::new(SoupTopicEvent::ItemUpdated(message)))
    }

    /// Builds an event from its Kafka key and pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<SoupTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }

    /// Returns the recipient-targeted message carried by this event.
    pub fn into_message(self) -> SoupRealtimeMessage {
        match self.event.event {
            SoupTopicEvent::ItemUpdated(message) => message,
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
