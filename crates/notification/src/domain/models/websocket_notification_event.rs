//! Broker event models for WebSocket notification delivery.

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroNotificationsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

/// Recipients and payload for one WebSocket notification delivery request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebSocketNotificationMetadata<T> {
    /// Users who should receive the notification.
    pub recipients: Vec<MacroUserIdStr<'static>>,
    /// Notification payload forwarded to each recipient.
    pub notification: T,
}

/// Events published to [`MacroNotificationsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum NotificationTopicEvent<T> {
    /// A notification should be delivered to active WebSocket connections.
    #[serde(rename = "notification.websocket_delivery_requested")]
    WebSocketDeliveryRequested(WebSocketNotificationMetadata<T>),
}

impl<T: Serialize + DeserializeOwned + Send + Sync> TopicEvent for NotificationTopicEvent<T> {
    type Topic = MacroNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable WebSocket notification event.
pub struct NotificationMacroEvent<T> {
    key: String,
    event: Event<NotificationTopicEvent<T>>,
}

impl<T: Serialize + DeserializeOwned + Send + Sync> NotificationMacroEvent<T> {
    /// Creates a delivery event keyed by its generated event ID.
    pub fn new(recipients: Vec<MacroUserIdStr<'static>>, notification: T) -> Self {
        let metadata = WebSocketNotificationMetadata {
            recipients,
            notification,
        };
        let event = Event::new(NotificationTopicEvent::WebSocketDeliveryRequested(metadata));
        let key = event.event_id.to_string();

        Self::with_event(key, event)
    }

    /// Builds an event from its Kafka key and pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<NotificationTopicEvent<T>>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl<T: Serialize + DeserializeOwned + Send + Sync> MacroEvent for NotificationMacroEvent<T> {
    type EventPayload = NotificationTopicEvent<T>;

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
