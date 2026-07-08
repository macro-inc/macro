#![deny(missing_docs)]
//! Favorites: user- and team-scoped ordered collections of entities,
//! following the hexagonal architecture pattern.
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
