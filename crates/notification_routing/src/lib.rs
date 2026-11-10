#![deny(missing_docs)]
//! Notification stacks: a person's own rules for routing a notification into
//! a lane before it is delivered.
//!
//! A stack captures the notifications its capture rules match and files them
//! in its lane, except those its release rules let through. Rules are
//! deterministic predicates over the notification: where it happened, its
//! kind, and who sent it.
//!
//! # Architecture
//!
//! - **domain**: the stack and rule model, the pure evaluator, the ports, the
//!   stack service and the router `notification` calls at ingress.
//! - **inbound**: the Axum router for managing stacks.
//! - **outbound**: the Postgres adapters.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

pub mod outbound;
