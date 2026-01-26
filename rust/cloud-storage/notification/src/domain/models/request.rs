//! Request and response models for the notification service.

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::{Report, report};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{Notification, RateLimitConfig, RateLimitKey},
    service::SendNotificationError,
};

/// Request to send a notification.
///
/// Generic over the notification payload type `T`, which must implement
/// the `Notification` trait. The event type is derived from `T::TYPE_NAME`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(bound = "T: Notification")]
pub struct SendNotificationRequest<'a, T> {
    /// The entity associated with this notification (e.g., Channel, Team, Document).
    pub notification_entity: Entity<'a>,
    /// The notification payload (implements `Notification` trait).
    pub notification: T,
    /// The user who triggered this notification (optional).
    pub sender_id: Option<MacroUserIdStr<'a>>,
    /// The users who should receive this notification.
    pub recipient_ids: Vec<MacroUserIdStr<'a>>,
}

impl<'a, T: Notification> SendNotificationRequest<'a, T> {
    /// Get the event type name from the notification.
    pub fn event_type(&self) -> &'static str {
        T::TYPE_NAME
    }

    pub fn get_rate_limit(
        &self,
    ) -> Result<Option<(RateLimitKey, RateLimitConfig)>, Report<SendNotificationError>> {
        let config = T::rate_limit_config();
        let key = self.notification.rate_limit_key();

        match (config, key) {
            (Some(config), Some(key)) => Ok(Some((key, config))),
            (None, None) => Ok(None),
            (Some(_), None) | (None, Some(_)) => {
                return Err(report!(SendNotificationError::RateLimitConfigErr));
            }
        }
    }
}

/// Result of sending a notification.
#[derive(Debug, Clone)]
pub struct NotificationResult {
    /// The unique ID of the created notification.
    pub notification_id: Uuid,
    /// The users who were actually notified (after filtering).
    pub notified_recipients: HashSet<MacroUserIdStr<'static>>,
    /// Delivery status across channels.
    pub delivery_status: DeliveryStatus,
}

/// Tracks delivery status across different channels.
#[derive(Debug, Clone, Default)]
pub struct DeliveryStatus {
    /// Users who received the notification via WebSocket.
    pub websocket_delivered: HashSet<MacroUserIdStr<'static>>,
    /// Users who received the notification via push notification.
    pub push_delivered: HashSet<MacroUserIdStr<'static>>,
    /// Users for whom email was queued.
    pub email_queued: HashSet<MacroUserIdStr<'static>>,
}

/// Criteria for revoking/deleting notifications.
///
/// All fields are optional - combine them to narrow the scope.
/// At least one field must be set to prevent accidental mass deletion.
#[derive(Debug, Clone, Default)]
pub struct RevokeCriteria<'a> {
    /// Filter by entity (e.g., Channel, Team, Document).
    pub entity: Option<Entity<'a>>,
    /// Filter by notification event type name.
    pub event_type: Option<&'a str>,
    /// Filter by recipient user.
    pub recipient: Option<MacroUserIdStr<'a>>,
    /// Filter by sender user.
    pub sender: Option<MacroUserIdStr<'a>>,
}

impl<'a> RevokeCriteria<'a> {
    /// Returns true if at least one filter is set.
    pub fn has_filter(&self) -> bool {
        self.entity.is_some()
            || self.event_type.is_some()
            || self.recipient.is_some()
            || self.sender.is_some()
    }
}
