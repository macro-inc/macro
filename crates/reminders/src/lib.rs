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
//! - **inbound**: driving adapters (Axum HTTP router, dispatch queue worker).
//! - **outbound**: driven adapters (Postgres repository, SQS dispatch queue).
//!
//! Delivery lives here too, as a pub/sub fan-out over a single queue: a
//! scheduled tick sweeps for due firings and publishes one message each, and
//! the same pool of workers claims, notifies and completes them in parallel.
//! Recurring schedules are modelled and stored but not yet dispatched.

pub mod domain;

#[cfg(any(feature = "inbound", feature = "dispatch"))]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
