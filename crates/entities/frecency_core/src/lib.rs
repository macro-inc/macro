#![deny(missing_docs)]
//! Frecency scoring: event and aggregate models, the storage and time ports,
//! and the services that record events, aggregate them and read top entities.
//!
//! The Postgres storage is `frecency_outbound`; the polling aggregation
//! worker is `frecency_inbound`. Crates that need only the models and ports
//! depend on this crate, so a storage edit does not rebuild them.

pub mod models;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod services;
