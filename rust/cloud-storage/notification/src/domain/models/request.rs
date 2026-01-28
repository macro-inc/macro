//! Request and response models for the notification service.

use crate::domain::{
    models::{
        Notification, RateLimitConfig, RateLimitKey, apple::APNSPushNotification,
        mobile::MessageAttributes, queue_message::EmailContent,
    },
    service::SendNotificationError,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::{Report, report};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

/// Request to send a notification.
///
/// Generic over the notification payload type `T`, which must implement
/// the `Notification` trait. The event type is derived from `T::TYPE_NAME`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(bound = "T: Notification")]
pub struct SendNotificationRequestBuilder<'a, T> {
    /// The entity associated with this notification (e.g., Channel, Team, Document).
    pub notification_entity: Entity<'a>,
    /// The notification payload (implements `Notification` trait).
    pub notification: T,
    /// The user who triggered this notification (optional).
    pub sender_id: Option<MacroUserIdStr<'a>>,
    /// The users who should receive this notification.
    pub recipient_ids: HashSet<MacroUserIdStr<'a>>,
}

impl<'a, T> SendNotificationRequestBuilder<'a, T> {
    /// Convert this builder into a full request with optional delivery customizers.
    pub fn into_request(self) -> SendNotificationRequest<'a, T> {
        SendNotificationRequest {
            req: self,
            build_apns: None,
            build_email: None,
            send_conn_gateway: false,
        }
    }
}

type BuildApns<T> = Box<dyn FnMut(T) -> (APNSPushNotification<T>, MessageAttributes)>;

/// Full notification request with optional delivery channel builders.
///
/// Created from [`SendNotificationRequestBuilder::into_request`] and can be
/// customized with APNS and email builders.
pub struct SendNotificationRequest<'a, T> {
    pub(crate) req: SendNotificationRequestBuilder<'a, T>,
    /// define how to turn t into an APNSPushNotitication T to be sent to ios
    pub(crate) build_apns: Option<BuildApns<T>>,
    /// define how to turn T into an email content to be sent as an email
    pub(crate) build_email: Option<Box<dyn FnMut(T) -> EmailContent>>,
    /// connection gateway accepts arbitrary json so we just ask if its enabled or not
    pub(crate) send_conn_gateway: bool,
}

impl<'a, T> SendNotificationRequest<'a, T> {
    /// Add a custom APNS notification builder.
    pub fn with_apns(
        mut self,
        cb: Box<dyn FnMut(T) -> (APNSPushNotification<T>, MessageAttributes)>,
    ) -> Self {
        self.build_apns.replace(cb);
        self
    }

    /// Add a custom email content builder.
    pub fn with_email(mut self, cb: Box<dyn FnMut(T) -> EmailContent>) -> Self {
        self.build_email.replace(cb);
        self
    }

    /// Enable delivery via connection gateway (WebSocket).
    pub fn with_conn_gateway(mut self) -> Self {
        self.send_conn_gateway = true;
        self
    }

    pub(crate) fn update_recipients(mut self, recipients: HashSet<MacroUserIdStr<'a>>) -> Self {
        self.req.recipient_ids = recipients;
        self
    }
}

impl<'a, T: Notification> SendNotificationRequestBuilder<'a, T> {
    /// Get the event type name from the notification.
    pub fn event_type(&self) -> &'static str {
        T::TYPE_NAME
    }

    /// return the valid rate limit for this notification if it exists,
    /// return none if there is no rate limit or error if there is a misconfig
    pub fn get_rate_limit(
        &self,
    ) -> Result<Option<(RateLimitKey, RateLimitConfig)>, Report<SendNotificationError>> {
        let config = T::rate_limit_config();
        let key = self.notification.rate_limit_key();

        match (config, key) {
            (Some(config), Some(key)) => Ok(Some((key, config))),
            (None, None) => Ok(None),
            (Some(_), None) | (None, Some(_)) => {
                Err(report!(SendNotificationError::RateLimitConfigErr))
            }
        }
    }
}

/// Result of sending a notification.
#[derive(Debug, Clone)]
pub struct NotificationResult<'a> {
    /// The unique ID of the created notification.
    pub notification_id: Uuid,
    /// The users who were actually notified (after filtering).
    pub notified_recipients: HashSet<MacroUserIdStr<'a>>,
}
