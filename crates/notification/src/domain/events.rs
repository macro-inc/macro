//! Who receives notification events outside Macro, and in what shape: the
//! access of [`NotificationTopicEvent`] and its public projection.

use std::borrow::Cow;

use crate::domain::models::websocket_notification_event::{
    NotificationTopicEvent, WebSocketNotificationMetadata,
};
use crate::domain::models::{NotificationDelete, PatchDelete, UserNotificationRow};
use macro_event_broker::access::EventAccess;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Serialize, de::DeserializeOwned};
use uuid::Uuid;

impl<'a, T: Clone + Serialize + DeserializeOwned + Send + Sync> EventAccess
    for NotificationTopicEvent<'a, T>
{
    type PublicPayload = NotificationPublicEvent;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{Access, EntityRef, PublicEntityType, PublicEvent, Stage};

        let (name, notification_id, recipients, payload) = match self {
            Self::WebSocketDeliveryRequested(WebSocketNotificationMetadata { notifications }) => {
                // One delivery carries the same notification for each recipient;
                // only the owner differs between rows. Rows for any other
                // notification are not this event's subject and get nothing.
                let Some(first) = notifications.first() else {
                    return Ok(Access::Internal {
                        reason: "a delivery request with no recipients",
                    });
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
                if users.is_empty() {
                    return Ok(Access::Internal {
                        reason: "a status update with no recipients",
                    });
                }
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
                    return Ok(Access::Internal {
                        reason: "a status update with no changes",
                    });
                };
                (
                    NOTIFICATION_UPDATED,
                    first.notification_id(),
                    vec![user.clone().into_owned()],
                    NotificationPublicEvent::Updated(NotificationUpdated { changes }),
                )
            }
        };
        Ok(Access::Public(PublicEvent {
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
) -> macro_event_broker::access::Audience {
    use macro_event_broker::access::Audience;

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
    pub entity_type: macro_event_broker::access::EntityType,
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
