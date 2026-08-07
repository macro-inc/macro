//! Inbound (driving) adapters for reminders.

#[cfg(feature = "inbound")]
pub mod axum_router;

#[cfg(feature = "dispatch")]
pub mod dispatch_worker;
