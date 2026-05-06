//! Core notification service implementation.
//!
//! Contains two services:
//! - [`NotificationIngressService`]: For callers to send notifications (filter, persist, publish to queue)
//! - [`NotificationEgressService`]: For workers to deliver notifications (consume from queue, deliver)

pub mod device;
mod egress;
mod ingress;
mod push_notification_event;
#[cfg(test)]
mod test;
mod voip;

use thiserror::Error;

pub use egress::NotificationEgressService;
pub use ingress::NotificationIngress;
pub use ingress::NotificationIngressService;
pub use ingress::NotificationReader;
pub use ingress::NotificationReaderService;
pub use ingress::PlatformArnConfig;
pub use ingress::SqsNotificationIngress;
pub use push_notification_event::PushNotificationEventHandler;
pub use push_notification_event::PushNotificationEventService;
pub use voip::VoipPushServiceImpl;

/// Error returned when sending a notification fails.
#[derive(Debug, Error)]
pub enum SendNotificationError {
    /// Invalid rate limit config, either a key was provided but a key was not, or vice versa.
    #[error("Rate limit config error")]
    RateLimitConfigErr,
    /// An internal error occurred.
    #[error("Internal error")]
    Other,
}
