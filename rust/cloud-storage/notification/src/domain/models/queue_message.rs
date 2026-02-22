//! Queue message models for notification delivery via SQS.

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
    pub content: NotificationChannel<'a, T, U>,
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
                rate_limit,
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
                rate_limit,
                content,
            }
        };

        self.0.into_iter().map(map_msg)
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
