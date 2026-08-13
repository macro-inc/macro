//! Broker event models for realtime notification delivery.

use std::borrow::Cow;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroNotificationsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::models::{PatchDelete, UserNotificationRow};

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
pub enum NotificationTopicEvent<'a, T: Clone> {
    /// A notification should be delivered to active WebSocket connections.
    #[serde(rename = "notification.websocket_delivery_requested")]
    WebSocketDeliveryRequested(WebSocketNotificationMetadata<T>),
    /// Notification rows were patched or deleted for a set of users.
    #[serde(rename = "notification.status_updated")]
    NotificationStatusUpdated {
        /// Users who own the notification updates.
        users: Vec<MacroUserIdStr<'a>>,
        /// Notification row patches and deletes shared by the users.
        updates: Vec<PatchDelete<Uuid, Cow<'a, UserNotificationRow<T>>>>,
    },
}

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> TopicEvent
    for NotificationTopicEvent<'a, T>
{
    type Topic = MacroNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable realtime notification event.
pub struct NotificationMacroEvent<'a, T: Clone> {
    key: String,
    event: Event<NotificationTopicEvent<'a, T>>,
}

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> NotificationMacroEvent<'a, T> {
    /// Creates a notification status update event keyed by its generated event ID.
    pub fn status_updated(
        users: Vec<MacroUserIdStr<'a>>,
        updates: Vec<PatchDelete<Uuid, Cow<'a, UserNotificationRow<T>>>>,
    ) -> Self {
        let event =
            Event::new(NotificationTopicEvent::NotificationStatusUpdated { users, updates });
        let key = event.event_id.to_string();

        Self::with_event(key, event)
    }

    /// Builds an event from its Kafka key and pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<NotificationTopicEvent<'a, T>>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }

    /// Returns the topic event carried by this event.
    pub fn into_topic_event(self) -> NotificationTopicEvent<'a, T> {
        self.event.event
    }
}

impl<T: Clone + Serialize + DeserializeOwned + Send + Sync + 'static>
    NotificationMacroEvent<'static, T>
{
    /// Creates a WebSocket delivery event keyed by its generated event ID.
    pub fn new(recipients: Vec<MacroUserIdStr<'static>>, notification: T) -> Self {
        let metadata = WebSocketNotificationMetadata {
            recipients,
            notification,
        };
        let event = Event::new(NotificationTopicEvent::WebSocketDeliveryRequested(metadata));
        let key = event.event_id.to_string();

        Self::with_event(key, event)
    }
}

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> MacroEvent
    for NotificationMacroEvent<'a, T>
{
    type EventPayload = NotificationTopicEvent<'a, T>;

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

/// Realtime notification event decoded with arbitrary JSON notification metadata.
pub type JsonNotificationMacroEvent = NotificationMacroEvent<'static, serde_json::Value>;
