use crate::domain::models::{
    RateLimitConfig, RateLimitKey, apple::APNSPushNotification, mobile::MessageAttributes,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use thiserror::Error;

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

/// Connection gateway (WebSocket) notification payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConnGatewayNotification<'a, T> {
    /// The notification payload to send.
    pub notif: T,
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
