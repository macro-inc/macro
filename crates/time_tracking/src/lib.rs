#![deny(missing_docs)]
//! Time tracking: the time people log on tasks, typed or with a running timer,
//! and each task's Time logged, following the hexagonal architecture pattern.
//!
//! - An entry is a day and a length in whole minutes, by one person on one
//!   task. Its day is the one the person chose, never derived on read.
//! - A person has at most one running timer; stopping it saves an entry under
//!   the timer's id, so a stop sent twice saves one entry.
//! - The task's Time logged system property is the sum of its entries,
//!   rewritten in each entry write's transaction under the task's lock.
//!
//! # Architecture
//!
//! - **domain**: models, ports, events, the activity mapping and the service
//!   (permission rules, timer semantics, the over-limit refusal).
//! - **inbound**: the Axum HTTP router (feature `inbound`).
//! - **outbound**: Postgres storage, the event broker publisher, the
//!   connection gateway hint to the person's open sessions and the rollout
//!   gate (feature `outbound`).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;

#[cfg(test)]
mod test_support;
