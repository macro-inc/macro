#![deny(missing_docs)]
//! Account managers: an agent account's full access to another account,
//! requested and approved in a DM, following the hexagonal architecture pattern.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router).
//! - **outbound**: driven adapters (Postgres repository, DM delivery).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(any(feature = "outbound", feature = "postgres"))]
pub mod outbound;
