//! Broker event models for realtime notification delivery.

#[cfg(test)]
mod test;

use std::borrow::Cow;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroNotificationsTopic;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::{Report, ResultExt as _};
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

impl NotificationTopicEvent<'static, serde_json::Value> {
    /// Deserializes the JSON metadata carried by every notification row into `T`.
    ///
    /// Status patches use the row's notification event type as the external serde tag,
    /// while delivery requests deserialize their metadata values directly.
    pub fn deserialize_metadata<T>(self) -> Result<NotificationTopicEvent<'static, T>, Report>
    where
        T: Clone + DeserializeOwned + 'static,
    {
        match self {
            NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
                notifications,
            }) => Ok(NotificationTopicEvent::WebSocketDeliveryRequested(
                WebSocketNotificationMetadata {
                    notifications: notifications
                        .into_iter()
                        .map(decode_notification_row)
                        .collect::<Result<Vec<_>, _>>()?,
                },
            )),
            NotificationTopicEvent::NotificationStatusUpdatedForUsers { users, update } => {
                Ok(NotificationTopicEvent::NotificationStatusUpdatedForUsers { users, update })
            }
            NotificationTopicEvent::NotificationStatusesUpdatedForUser { user, updates } => {
                Ok(NotificationTopicEvent::NotificationStatusesUpdatedForUser {
                    user,
                    updates: updates
                        .into_iter()
                        .map(decode_update)
                        .collect::<Result<Vec<_>, _>>()?,
                })
            }
        }
    }
}

fn decode_notification_row<T>(
    row: UserNotificationRow<serde_json::Value>,
) -> Result<UserNotificationRow<T>, Report>
where
    T: DeserializeOwned,
{
    Ok(row.try_map(|metadata| {
        serde_json::from_value(metadata).context("failed to decode notification metadata")
    })?)
}

fn decode_status_notification_row<T>(
    row: UserNotificationRow<serde_json::Value>,
) -> Result<UserNotificationRow<T>, Report>
where
    T: DeserializeOwned,
{
    Ok(row
        .into_tagged()
        .deserialize_metadata::<T>()
        .context("failed to decode tagged notification status metadata")?)
}

fn decode_update<T>(
    update: PatchDelete<Uuid, Cow<'static, UserNotificationRow<serde_json::Value>>>,
) -> Result<PatchDelete<Uuid, Cow<'static, UserNotificationRow<T>>>, Report>
where
    T: Clone + DeserializeOwned + 'static,
{
    match update {
        PatchDelete::Patch { diff } => Ok(PatchDelete::Patch {
            diff: Cow::Owned(decode_status_notification_row(diff.into_owned())?),
        }),
        PatchDelete::Delete { id } => Ok(PatchDelete::Delete { id }),
    }
}

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> TopicEvent
    for NotificationTopicEvent<'a, T>
{
    type Topic = MacroNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = NotificationPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            EntityRef, Exposure, PublicEntityType, PublicEvent, Stage,
        };

        let (name, notification_id, recipients, payload) = match self {
            Self::WebSocketDeliveryRequested(WebSocketNotificationMetadata { notifications }) => {
                // One delivery carries the same notification for each recipient;
                // only the owner differs between rows. Rows for any other
                // notification are not this event's subject and get nothing.
                let Some(first) = notifications.first() else {
                    return Ok(Exposure::internal_by_design(
                        "a delivery request with no recipients",
                    ));
                };
                let recipients = notifications
                    .iter()
                    .filter(|row| row.notification_id == first.notification_id)
                    .map(|row| row.owner_id.clone());
                (
                    NOTIFICATION_CREATED,
                    first.notification_id,
                    recipients.collect::<Vec<_>>(),
                    NotificationPublicEvent::Created(NotificationCreated::from(first)),
                )
            }
            Self::NotificationStatusUpdatedForUsers { users, update } => {
                let NotificationDelete::Delete { id } = **update;
                (
                    NOTIFICATION_UPDATED,
                    id,
                    users.iter().map(|user| user.clone().into_owned()).collect(),
                    NotificationPublicEvent::Updated(NotificationUpdated {
                        changes: vec![NotificationChange::Deleted {
                            notification_id: id,
                        }],
                    }),
                )
            }
            Self::NotificationStatusesUpdatedForUser { user, updates } => {
                let changes: Vec<NotificationChange> =
                    updates.iter().map(NotificationChange::from).collect();
                let Some(first) = changes.first() else {
                    return Ok(Exposure::internal_by_design(
                        "a status update with no changes",
                    ));
                };
                (
                    NOTIFICATION_UPDATED,
                    first.notification_id(),
                    vec![user.clone().into_owned()],
                    NotificationPublicEvent::Updated(NotificationUpdated { changes }),
                )
            }
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(PublicEntityType::Notification, notification_id.to_string()),
            audience: recipients_audience(recipients),
            stage: Stage::Preview,
            payload: std::borrow::Cow::Owned(payload),
        }))
    }
}

const NOTIFICATION_CREATED: &str = "notification.created";
const NOTIFICATION_UPDATED: &str = "notification.updated";

/// Each addressed user, and nobody else: notifications are personal, so they
/// never reach a recipient's team webhooks.
fn recipients_audience(
    addressed: Vec<MacroUserIdStr<'static>>,
) -> macro_event_broker::exposure::Audience {
    use macro_event_broker::exposure::Audience;

    let mut recipients: Vec<MacroUserIdStr<'static>> = Vec::with_capacity(addressed.len());
    for user_id in addressed {
        if !recipients.contains(&user_id) {
            recipients.push(user_id);
        }
    }
    if let [user_id] = recipients.as_slice() {
        return Audience::Recipient {
            user_id: user_id.clone(),
        };
    }
    Audience::Any(
        recipients
            .into_iter()
            .map(|user_id| Audience::Recipient { user_id })
            .collect(),
    )
}

/// The public projection of [`NotificationTopicEvent`]. Each event goes only
/// to the users it addresses; the body is what they all share, never the
/// notification's content (read it back through the notification API).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum NotificationPublicEvent {
    /// A notification was delivered to the recipient.
    #[serde(rename = "notification.created")]
    Created(NotificationCreated),
    /// The recipient's notifications changed state or were deleted.
    #[serde(rename = "notification.updated")]
    Updated(NotificationUpdated),
}

/// Public body of `notification.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct NotificationCreated {
    /// The notification.
    pub notification_id: Uuid,
    /// The notification kind, such as `channel_mention`.
    pub kind: String,
    /// Type of the entity the notification is about.
    pub entity_type: macro_event_broker::exposure::EntityType,
    /// The entity the notification is about.
    pub entity_id: String,
    /// Who triggered it, when a user did.
    pub sender_id: Option<MacroUserIdStr<'static>>,
    /// When it was created.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl<T> From<&UserNotificationRow<T>> for NotificationCreated {
    fn from(row: &UserNotificationRow<T>) -> Self {
        Self {
            notification_id: row.notification_id,
            kind: row.notification_event_type.clone(),
            entity_type: row.entity.entity_type,
            entity_id: row.entity.entity_id.to_string(),
            sender_id: row.sender_id.clone(),
            created_at: row.created_at,
        }
    }
}

/// Public body of `notification.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct NotificationUpdated {
    /// What changed, per notification.
    pub changes: Vec<NotificationChange>,
}

/// One notification's change in `notification.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "change", rename_all = "snake_case")]
pub enum NotificationChange {
    /// The notification's state changed.
    Updated {
        /// The notification.
        notification_id: Uuid,
        /// Its state after the change.
        state: notification_state::NotificationState,
        /// When it was seen, if it has been.
        viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    },
    /// The notification was deleted for the recipient.
    Deleted {
        /// The notification.
        notification_id: Uuid,
    },
}

impl NotificationChange {
    /// The notification this change is about.
    pub fn notification_id(&self) -> Uuid {
        match self {
            Self::Updated {
                notification_id, ..
            }
            | Self::Deleted { notification_id } => *notification_id,
        }
    }
}

impl<T: Clone> From<&PatchDelete<Uuid, Cow<'_, UserNotificationRow<T>>>> for NotificationChange {
    fn from(update: &PatchDelete<Uuid, Cow<'_, UserNotificationRow<T>>>) -> Self {
        match update {
            PatchDelete::Patch { diff } => Self::Updated {
                notification_id: diff.notification_id,
                state: diff.state,
                viewed_at: diff.viewed_at,
            },
            PatchDelete::Delete { id } => Self::Deleted {
                notification_id: *id,
            },
        }
    }
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
