use crate::domain::models::{
    Notification, RateLimitConfig, RateLimitKey, SendNotificationRequest,
    apple::APNSPushNotification, mobile::MessageAttributes,
};
use chrono::{DateTime, Utc, serde::ts_seconds_option};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::{Entity, as_owned::IntoOwned};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// APNS push notification targets.
#[derive(Debug, Serialize, Deserialize)]
pub struct APNSTargets<T> {
    /// The APNS notification payload.
    pub notif: APNSPushNotification<T>,
    pub attributes: MessageAttributes,
    /// The iOS device endpoints to deliver to.
    pub ios_device_endpoints: Vec<String>,
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
    pub content: EmailContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notif<T> {
    /// The notification ID.
    #[serde(rename = "id")]
    pub(crate) notification_id: uuid::Uuid,
    /// The notification event type string (e.g. "channel_mention").
    /// TODO make this a new type
    pub(crate) notification_event_type: String,
    /// The entity the notification is about.
    #[serde(flatten)]
    pub(crate) entity: Entity<'static>,
    /// Whether the notification has been sent.
    pub(crate) sent: bool,
    /// Whether the notification is marked as done.
    pub(crate) done: bool,
    /// When the notification was created.
    #[serde(with = "ts_seconds_option")]
    pub(crate) created_at: Option<DateTime<Utc>>,
    /// When the notification was viewed/seen.
    #[serde(with = "ts_seconds_option")]
    pub(crate) viewed_at: Option<DateTime<Utc>>,
    /// When the notification was last updated.
    #[serde(with = "ts_seconds_option")]
    pub(crate) updated_at: Option<DateTime<Utc>>,
    /// When the notification was deleted.
    #[serde(with = "ts_seconds_option")]
    pub(crate) deleted_at: Option<DateTime<Utc>>,
    /// Deserialized notification metadata.
    pub(crate) notification_metadata: T,
    /// The user who triggered the notification.
    pub(crate) sender_id: Option<MacroUserIdStr<'static>>,
}

impl<T> Notif<T>
where
    T: Notification + Clone,
{
    pub(crate) fn clone_from_request<U>(id: Uuid, req: &SendNotificationRequest<'_, T, U>) -> Self {
        Notif {
            notification_id: id,
            notification_event_type: T::TYPE_NAME.to_string(),
            entity: req.req.notification_entity.clone().into_owned(),
            sent: true,
            done: false,
            created_at: None,
            viewed_at: None,
            updated_at: None,
            deleted_at: None,
            notification_metadata: req.req.notification.clone(),
            sender_id: req.req.sender_id.as_ref().map(|x| x.clone().into_owned()),
        }
    }
}

/// Connection gateway (WebSocket) notification payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConnGatewayNotification<'a, T> {
    /// The notification payload to send.
    pub notif: Notif<T>,
    /// The recipients to deliver to.
    pub recipients: Vec<MacroUserIdStr<'a>>,
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

#[derive(Debug, Error)]
pub enum DeliveryFailure {
    #[error("The rate limit was exceeded")]
    RateLimit,
    #[error("A delivery error occured")]
    Other,
}
