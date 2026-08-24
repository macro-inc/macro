//! Broker event models for realtime notification delivery.

use std::borrow::Cow;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroNotificationsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::models::{NotificationDelete, PatchDelete, UserNotificationRow};

/// User-scoped notification rows for WebSocket delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebSocketNotificationMetadata<T> {
    /// Notification rows to deliver to their respective owners.
    pub notifications: Vec<UserNotificationRow<T>>,
}

/// Events published to [`MacroNotificationsTopic`].
///
/// `T` is the notification metadata type carried inside each [`UserNotificationRow`], typically
/// `NotifEvent` in application code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum NotificationTopicEvent<'a, T: Clone> {
    /// A notification should be delivered to active WebSocket connections.
    #[serde(rename = "notification.websocket_delivery_requested")]
    WebSocketDeliveryRequested(WebSocketNotificationMetadata<T>),
    /// One notification was deleted for a set of users.
    #[serde(rename = "notification.status_updated_for_users")]
    NotificationStatusUpdatedForUsers {
        /// Users who own the notification deletion.
        users: Vec<MacroUserIdStr<'a>>,
        /// Notification deletion shared by the users.
        update: Box<NotificationDelete<Uuid>>,
    },
    /// Several notifications were patched or deleted for one user.
    #[serde(rename = "notification.statuses_updated_for_user")]
    NotificationStatusesUpdatedForUser {
        /// User who owns the notification updates.
        user: MacroUserIdStr<'a>,
        /// Notification row patches and deletions for the user.
        updates: Vec<PatchDelete<Uuid, Cow<'a, UserNotificationRow<T>>>>,
    },
}

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> TopicEvent
    for NotificationTopicEvent<'a, T>
{
    type Topic = MacroNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable realtime notification event carrying notification metadata of type `T`.
pub struct NotificationMacroEvent<'a, T: Clone> {
    key: String,
    event: Event<NotificationTopicEvent<'a, T>>,
}

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> NotificationMacroEvent<'a, T> {
    /// Creates an event for one notification deletion shared by several users.
    pub fn status_updated_for_users(
        users: Vec<MacroUserIdStr<'a>>,
        update: Box<NotificationDelete<Uuid>>,
    ) -> Self {
        let event =
            Event::new(NotificationTopicEvent::NotificationStatusUpdatedForUsers { users, update });
        let key = event.event_id.to_string();

        Self::with_event(key, event)
    }

    /// Creates an event for several notification status updates belonging to one user.
    pub fn statuses_updated_for_user(
        user: MacroUserIdStr<'a>,
        updates: Vec<PatchDelete<Uuid, Cow<'a, UserNotificationRow<T>>>>,
    ) -> Self {
        let event = Event::new(NotificationTopicEvent::NotificationStatusesUpdatedForUser {
            user,
            updates,
        });
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
    pub fn new(notifications: Vec<UserNotificationRow<T>>) -> Self {
        let metadata = WebSocketNotificationMetadata { notifications };
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
