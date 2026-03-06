//! Queue message models for notification delivery via SQS.

use crate::domain::models::{
    Notification, NotificationExtEmail, RateLimitConfig, RateLimitKey, SendNotificationRequest,
    TaggedContent,
    apple::APNSPushNotification,
    email_notification_digest::{BatchSend, PushNotificationsEnabled, StateMachineDecisionA},
    mobile::MessageAttributes,
};
use chrono::{DateTime, Utc};
use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Per-user iOS push delivery targets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApnsEndpoints {
    /// The iOS device endpoint ARNs for this user.
    pub endpoints: Vec<String>,
    /// State machine data if the ingress decision was indeterminate for this user.
    #[serde(default)]
    pub digest_state: Option<BatchSend<PushNotificationsEnabled>>,
}

/// APNS push notification targets.
#[derive(Debug, Serialize, Deserialize)]
pub struct APNSTargets<T> {
    /// The APNS notification payload.
    pub notif: APNSPushNotification<T>,
    /// The APNS message attributes.
    pub attributes: MessageAttributes,
    /// Per-user iOS device endpoints and optional state machine data.
    pub ios_device_endpoints: HashMap<MacroUserIdStr<'static>, UserApnsEndpoints>,
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
    to: MacroUserIdStr<'a>,
    /// The email content (subject and body).
    pub content: EmailContent,

    rate_limit_config: RateLimitConfig,

    rate_limit_key: RateLimitKey,
}

pub(crate) struct EmailCreateBundle {
    /// The email content (subject and body).
    content: EmailContent,

    /// the configuration for the rate limit of the email
    rate_limit_config: RateLimitConfig,

    /// the key for this particular rate limit bucket
    rate_limit_key: RateLimitKey,
}

impl EmailCreateBundle {
    pub(crate) fn new<T: NotificationExtEmail>(notif: &T) -> Self {
        let rate_limit_config = T::rate_limit_config();
        let rate_limit_key = notif.rate_limit_key();
        let content = notif.format_email();
        EmailCreateBundle {
            content,
            rate_limit_config,
            rate_limit_key,
        }
    }

    pub(crate) fn with_recipient<'a>(self, to: MacroUserIdStr<'a>) -> EmailNotification<'a> {
        let EmailCreateBundle {
            content,
            rate_limit_config,
            rate_limit_key,
        } = self;
        EmailNotification {
            to,
            content,
            rate_limit_config,
            rate_limit_key,
        }
    }
}

impl<'a> EmailNotification<'a> {
    /// return the value of the recipient of the email
    pub fn to(&'a self) -> MacroUserIdStr<'a> {
        self.to.copied()
    }

    /// return the rate limit configuration
    pub fn rate_limit(&self) -> (&RateLimitConfig, &RateLimitKey) {
        (&self.rate_limit_config, &self.rate_limit_key)
    }
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
pub(crate) struct ConnGatewayNotification<'a, T> {
    /// The notification payload to send.
    pub(crate) notif: ConnGatewayInnerNotif<T>,
    /// The recipients to deliver to.
    pub(crate) recipients: Vec<MacroUserIdStr<'a>>,
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
pub(crate) enum NotificationChannel<'a, T, U> {
    /// Delivering to an iOS device with APNS.
    Ios(Box<APNSTargets<U>>),
    /// Delivering to a user's email inbox.
    Email(EmailNotification<'a>),
    /// Delivering a foreground notification via connection gateway.
    ConnGateway(ConnGatewayNotification<'a, T>),
}

/// Message published to SQS after DB persistence.
/// Contains everything needed for delivery.
///
/// Fields are private — construct via [`QueueMessage::new`] which requires `T: Notification`.
#[derive(Debug, Serialize, Deserialize)]
pub struct QueueMessage<'a, T, U> {
    message_type: String,
    content: NotificationChannel<'a, T, U>,
}

impl<'a, T: Notification, U> QueueMessage<'a, T, U> {
    /// Create a new queue message. Only valid notification types can be published.
    ///
    /// The `message_type` is derived from [`Notification::TYPE_NAME`].
    pub(crate) fn new(content: NotificationChannel<'a, T, U>) -> Self {
        Self {
            message_type: T::TYPE_NAME.to_string(),
            content,
        }
    }
}

impl<'a, T, U> QueueMessage<'a, T, U> {
    /// Consume the message and return its content.
    pub(crate) fn into_inner(self) -> NotificationChannel<'a, T, U> {
        self.content
    }
}

#[cfg(test)]
impl<'a, T, U> QueueMessage<'a, T, U> {
    /// Test-only constructor that doesn't require `T: Notification`.
    pub(crate) fn new_test(message_type: String, content: NotificationChannel<'a, T, U>) -> Self {
        Self {
            message_type,
            content,
        }
    }
}

/// a wrapper type over [QueueMessage] which can only be opened by providing the decision from the bulk digest state machine
pub(crate) struct QueueMessageNeedsStateMachine<'a, T, U>(Vec<QueueMessage<'a, T, U>>);

impl<'a, T, U> QueueMessageNeedsStateMachine<'a, T, U> {
    pub fn new(messages: Vec<QueueMessage<'a, T, U>>) -> Self {
        Self(messages)
    }

    /// open the inner container by applying the state machine output to the necessary fields
    pub fn with_state_decisions(
        self,
        states: Vec<Result<StateMachineDecisionA<T>, Report>>,
    ) -> impl Iterator<Item = QueueMessage<'a, T, U>> {
        // Collect indeterminate decisions keyed by owner_id
        let indeterminates: HashMap<MacroUserIdStr<'static>, BatchSend<PushNotificationsEnabled>> =
            states
                .into_iter()
                .filter_map(|v| match v {
                    Ok(StateMachineDecisionA::Indeterminate(indeterminate)) => Some(indeterminate),
                    Err(_)
                    | Ok(StateMachineDecisionA::DontSend(_))
                    | Ok(StateMachineDecisionA::BatchWasQueued(_))
                    | Ok(StateMachineDecisionA::SendImmediate(_)) => None,
                })
                .map(|batch| {
                    let owner = batch.inner().owner_id().clone();
                    (owner, batch)
                })
                .collect();

        let mut indeterminates = Some(indeterminates);

        let map_msg = move |msg: QueueMessage<'a, T, U>| {
            let QueueMessage {
                message_type,
                mut content,
            } = msg;

            if let NotificationChannel::Ios(ios) = &mut content {
                if let Some(ref mut lookup) = indeterminates {
                    for (user_id, user_endpoints) in &mut ios.ios_device_endpoints {
                        if let Some(entry) = lookup.remove(user_id) {
                            user_endpoints.digest_state = Some(entry);
                        }
                    }
                }
                indeterminates = None;
            }

            QueueMessage {
                message_type,
                content,
            }
        };

        self.0.into_iter().map(map_msg)
    }
}

/// Custom data payload for a silent background push that clears a previously
/// delivered notification from the user's device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearPushIdentifier {
    /// The collapse key identifier used to match the notification to clear.
    pub identifier: String,
}

impl Notification for ClearPushIdentifier {
    const TYPE_NAME: &'static str = "clear_push_notification";
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
