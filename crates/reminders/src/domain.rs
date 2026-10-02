//! Domain layer for reminders.

#[cfg(feature = "ports")]
pub mod collection;
pub mod models;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;

#[cfg(feature = "ports")]
pub mod email_followup;
