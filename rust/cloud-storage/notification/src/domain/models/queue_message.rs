//! Queue message models for notification delivery via SQS.

use std::sync::Arc;

use crate::domain::models::{
    Notification, RateLimitConfig, RateLimitKey, SendNotificationRequest, TaggedContent,
    apple::APNSPushNotification,
    email_notification_digest::{BatchSend, PushNotificationsEnabled, StateMachineDecisionA},
    mobile::MessageAttributes,
};
use chrono::{DateTime, Utc};
use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// APNS push notification targets.
#[derive(Debug, Serialize, Deserialize)]
pub struct APNSTargets<T> {
    /// The APNS notification payload.
    pub notif: APNSPushNotification<T>,
    /// The APNS message attributes.
    pub attributes: MessageAttributes,
    /// The iOS device endpoints to deliver to.
    pub ios_device_endpoints: Vec<String>,
    /// if the state machine returned that the decision is incomplete
    /// then we pass the state of the machine into the queue such that it
    /// can be resumed on the egress side.
    #[serde(default)]
    pub bulk_digest_state_machine: Option<Arc<BatchSend<PushNotificationsEnabled>>>,
}

/// Email notification payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct EmailContent {
    /// The email subject line.
    pub subject: String,
    /// The email body content.
    pub body: String,
}

/// Email notification payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct EmailNotification<'a> {
    /// The recipient email/user ID.
    pub to: MacroUserIdStr<'a>,
    /// The email content (subject and body).
    pub content: EmailContent,
}

/// the value of the inner payload inside [ConnGatewayNotification]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnGatewayInnerNotif<T> {
    /// The notification ID.
    pub notification_id: uuid::Uuid,
    /// The notification event type string (e.g. "channel_mention").
    /// TODO make this a new type
    pub notification_event_type: String,
    /// The entity the notification is about.
    #[serde(flatten)]
    pub entity: Entity<'static>,
    /// Whether the notification has been sent.
    pub sent: bool,
    /// Whether the notification is marked as done.
    pub done: bool,
    /// When the notification was created.
    pub created_at: Option<DateTime<Utc>>,
    /// When the notification was viewed/seen.
    pub viewed_at: Option<DateTime<Utc>>,
    /// When the notification was last updated.
    pub updated_at: Option<DateTime<Utc>>,
    /// When the notification was deleted.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Deserialized notification metadata.
    pub notification_metadata: TaggedContent<T>,
    /// The user who triggered the notification.
    pub sender_id: Option<MacroUserIdStr<'static>>,
}

/// Connection gateway (WebSocket) notification payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConnGatewayNotification<'a, T> {
    /// The notification payload to send.
    pub notif: ConnGatewayInnerNotif<T>,
    /// The recipients to deliver to.
    pub recipients: Vec<MacroUserIdStr<'a>>,
}

impl<'a, T: Notification + Clone> ConnGatewayNotification<'a, T> {
    pub(crate) fn clone_from_request<U>(id: Uuid, req: &SendNotificationRequest<'a, T, U>) -> Self {
        ConnGatewayNotification {
            notif: ConnGatewayInnerNotif {
                notification_id: id,
                notification_event_type: T::TYPE_NAME.to_string(),
                entity: req.req.notification_entity.clone().into_owned(),
                sent: true,
                done: false,
                created_at: None,
                viewed_at: None,
                updated_at: None,
                deleted_at: None,
                notification_metadata: TaggedContent::new(req.req.notification.clone()),
                sender_id: req.req.sender_id.as_ref().map(|x| x.clone().into_owned()),
            },
            recipients: req.req.recipient_ids.iter().cloned().collect(),
        }
    }
}

#[cfg(test)]
impl<'a, T: Notification> ConnGatewayNotification<'a, T> {
    /// function which is used for testing do not use in runtime code
    pub fn testing_to_value(self) -> ConnGatewayNotification<'a, serde_json::Value> {
        let ConnGatewayNotification {
            notif:
                ConnGatewayInnerNotif {
                    notification_id,
                    notification_event_type,
                    entity,
                    sent,
                    done,
                    created_at,
                    viewed_at,
                    updated_at,
                    deleted_at,
                    notification_metadata: TaggedContent { tag, content },
                    sender_id,
                },
            recipients,
        } = self;

        ConnGatewayNotification {
            notif: ConnGatewayInnerNotif {
                notification_id,
                notification_event_type,
                entity,
                sent,
                done,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata: TaggedContent {
                    tag,
                    content: serde_json::to_value(content).unwrap(),
                },
                sender_id,
            },
            recipients,
        }
    }
}

/// The delivery channel variants.
#[derive(Debug, Serialize, Deserialize)]
pub enum NotificationChannel<'a, T, U> {
    /// Delivering to an iOS device with APNS.
    Ios(Box<APNSTargets<U>>),
    /// Delivering to a user's email inbox.
    Email(EmailNotification<'a>),
    /// Delivering a foreground notification via connection gateway.
    ConnGateway(ConnGatewayNotification<'a, T>),
}

/// A delivery node with optional fallback on failure.
#[derive(Debug, Serialize, Deserialize)]
pub struct Node<'a, T, U> {
    /// The channel of notification we are delivering on.
    pub notif: NotificationChannel<'a, T, U>,
    /// The optional next channel we will attempt to deliver on if this method fails.
    pub on_failure: Option<Box<Node<'a, T, U>>>,
}

impl<'a, T, U> Node<'a, T, U> {
    // applies an in place mapping of the node structure recursively
    fn map_mut_inner<F>(&mut self, mut f: F)
    where
        F: FnMut(&mut NotificationChannel<'a, T, U>),
    {
        f(&mut self.notif);
        self.on_failure.as_deref_mut().map(|p| f(&mut p.notif));
    }

    /// functional wrapper around [Self::map_mut_inner]
    pub(crate) fn map_mut<F>(mut self, f: F) -> Self
    where
        F: FnMut(&mut NotificationChannel<'a, T, U>),
    {
        self.map_mut_inner(f);
        self
    }
}

/// Message published to SQS after DB persistence.
/// Contains everything needed for delivery.
#[derive(Debug, Serialize, Deserialize)]
pub struct QueueMessage<'a, T, U> {
    /// The notification type name (e.g., "channel_message_send").
    pub message_type: String,
    /// The rate limit key for this notification.
    /// The configuration for this rate limiter.
    pub rate_limit: Option<(RateLimitKey, RateLimitConfig)>,
    /// The methods on which we will attempt to deliver.
    /// This is an ALL relationship.
    pub content: Node<'a, T, U>,
}

/// a wrapper type over [QueueMessage] which can only be opened by providing the decision from the bulk digest state machine
pub(crate) struct QueueMessageNeedsStateMachine<'a, T, U>(QueueMessage<'a, T, U>);

impl<'a, T, U> QueueMessageNeedsStateMachine<'a, T, U> {
    pub fn new(inner: QueueMessage<'a, T, U>) -> Self {
        QueueMessageNeedsStateMachine(inner)
    }

    /// open the inner container by applying the state machine output to the necessary fields
    pub fn with_state(self, state: StateMachineDecisionA<T>) -> QueueMessage<'a, T, U> {
        let val = match state {
            StateMachineDecisionA::Indeterminate(batch_send) => Some(Arc::new(batch_send)),
            StateMachineDecisionA::SendImmediate(_)
            | StateMachineDecisionA::DontSend(_)
            | StateMachineDecisionA::BatchWasQueued(_) => None,
        };

        let QueueMessage {
            message_type,
            rate_limit,
            content,
        } = self.0;

        let content = match val {
            Some(v) => content.map_mut(move |notif| {
                if let NotificationChannel::Ios(ios) = notif {
                    ios.bulk_digest_state_machine.insert(v.clone());
                }
            }),
            None => content,
        };

        QueueMessage {
            message_type,
            rate_limit,
            content,
        }
    }
}

/// Custom data payload for a silent background push that clears a previously
/// delivered notification from the user's device.
#[derive(Debug, Serialize, Deserialize)]
pub struct ClearPushIdentifier {
    /// The collapse key identifier used to match the notification to clear.
    pub identifier: String,
}

/// Raw message received from SQS.
#[derive(Debug)]
pub struct RawQueueMessage {
    /// The deserialized queue message body.
    pub body: QueueMessage<'static, serde_json::Value, serde_json::Value>,
    /// The receipt handle for deleting the message after processing.
    pub receipt_handle: String,
}

/// Successful delivery result.
#[derive(Debug)]
pub enum DeliverySuccess {
    /// Delivered via iOS push.
    Ios,
    /// Delivered via connection gateway (WebSocket).
    ConnGateway,
    /// Delivered via email.
    Email,
}

/// Failure during notification delivery.
#[derive(Debug, Error)]
pub enum DeliveryFailure {
    /// The rate limit for this notification type was exceeded.
    #[error("The rate limit was exceeded")]
    RateLimit,
    /// A delivery error occurred.
    #[error("A delivery error occured")]
    Other,
}
