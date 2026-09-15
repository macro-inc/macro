#![deny(missing_docs)]
//! Initiatives: a named grouping of tasks, following the hexagonal architecture
//! pattern.
//!
//! This crate owns initiative lifecycle and assignment policy. Persistence and
//! HTTP adapters land in follow-up tasks.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router).
//! - **outbound**: driven adapters (Postgres repository).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
