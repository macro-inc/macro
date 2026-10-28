#![deny(missing_docs)]
//! Favorites: user- and team-scoped ordered collections of entities,
//! following the hexagonal architecture pattern.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router and AI toolset).
//! - **outbound**: driven adapters (Postgres repository).

pub mod domain;

#[cfg(any(feature = "inbound", feature = "ai_tools"))]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
