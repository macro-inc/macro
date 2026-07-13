//! Domain models for SNS push notification platform events.
//!
//! These events are published by AWS SNS when push notification delivery fails
//! or when a platform endpoint is deleted.

use crate::domain::models::email_notification_digest::ports::MessageId;

/// The type of SNS push notification platform event.
#[derive(Debug, serde::Deserialize)]
pub enum EventType {
    /// A push notification delivery failed.
    #[serde(rename = "DeliveryFailure")]
    DeliveryFailure,
    /// An SNS platform endpoint was deleted.
    #[serde(rename = "EndpointDeleted")]
    EndpointDeleted,
}

/// An SNS push notification platform event received from the event queue.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SnsPushNotificationEvent {
    /// The ARN of the SNS platform endpoint.
    pub endpoint_arn: String,
    /// The type of event that occurred.
    pub event_type: EventType,
    /// the SNS message unique identifier
    pub message_id: MessageId,
}

/// A raw push notification event message received from the queue.
#[derive(Debug)]
pub struct RawPushNotificationEventMessage {
    /// The message body as a raw string.
    pub body: Option<String>,
    /// The receipt handle for deleting the message from the queue.
    pub receipt_handle: Option<String>,
}
