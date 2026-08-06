#![deny(missing_docs)]
//! Reminders: user-scoped scheduled nudges, optionally attached to an entity,
//! following the hexagonal architecture pattern.
//!
//! A reminder fires either once (`remind_at`) or repeatedly on a cron schedule
//! evaluated in the user's timezone. Attaching a reminder to an entity requires
//! view access to that entity; the reminder itself is private to its owner.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router).
//! - **outbound**: driven adapters (Postgres repository).
//!
//! Delivery is out of scope: the dispatcher that fires due reminders and writes
//! `reminder_occurrence` rows does not exist yet.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
