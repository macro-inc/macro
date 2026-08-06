//! Outbound (driven) adapters for reminders.

#[cfg(feature = "notify")]
pub mod notification_notifier;

#[cfg(feature = "postgres")]
pub mod pg_reminders_repo;
