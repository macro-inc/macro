//! Core notification service implementation.
//!
//! Contains two services:
//! - [`NotificationIngressService`]: For callers to send notifications (filter, persist, publish to queue)
//! - [`NotificationEgressService`]: For workers to deliver notifications (consume from queue, deliver)

mod egress;
mod ingress;
#[cfg(test)]
mod test;

use thiserror::Error;

pub use egress::NotificationEgressService;
pub use ingress::NotificationIngress;
pub use ingress::NotificationIngressService;

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
