//! Broker event models for WebSocket notification delivery.

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroNotificationsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

/// Recipients and payload for one WebSocket notification delivery request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebSocketNotificationMetadata {
    /// Users who should receive the notification.
    pub recipients: Vec<MacroUserIdStr<'static>>,
    /// Notification payload forwarded to each recipient.
    pub notification: serde_json::Value,
}

/// Events published to [`MacroNotificationsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum NotificationTopicEvent {
    /// A notification should be delivered to active WebSocket connections.
    #[serde(rename = "notification.websocket_delivery_requested")]
    WebSocketDeliveryRequested(WebSocketNotificationMetadata),
}

impl TopicEvent for NotificationTopicEvent {
    type Topic = MacroNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable WebSocket notification event.
pub struct NotificationMacroEvent {
    key: String,
    event: Event<NotificationTopicEvent>,
}

impl NotificationMacroEvent {
    /// Creates a delivery event keyed by its generated event ID.
    pub fn new(recipients: Vec<MacroUserIdStr<'static>>, notification: serde_json::Value) -> Self {
        let metadata = WebSocketNotificationMetadata {
            recipients,
            notification,
        };
        let event = Event::new(NotificationTopicEvent::WebSocketDeliveryRequested(metadata));
        let key = event.event_id.to_string();

        Self::with_event(key, event)
    }

    /// Builds an event from its Kafka key and pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<NotificationTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for NotificationMacroEvent {
    type EventPayload = NotificationTopicEvent;

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
