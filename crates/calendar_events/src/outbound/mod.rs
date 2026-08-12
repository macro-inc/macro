//! Outbound calendar adapters.

/// Google Calendar API adapter.
#[cfg(feature = "google")]
pub mod google;
/// Notification-service calendar reminder notifier.
#[cfg(feature = "notify")]
pub mod notification_notifier;
/// PostgreSQL calendar repository.
#[cfg(feature = "postgres")]
pub mod pg;
/// SQS calendar reminder dispatch queue.
#[cfg(feature = "dispatch-sqs")]
pub mod sqs_dispatch_queue;
