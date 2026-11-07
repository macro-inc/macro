#![deny(missing_docs)]
//! User-scoped realtime Soup fan-out: patch models, ports and orchestration.
//!
//! The Kafka event consumer is `soup_realtime_inbound`; the Kafka, access and
//! agent-session adapters are `soup_realtime_outbound`. No composition root;
//! starts no tasks.

/// Versioned output message models.
pub mod models;

/// Inbound and outbound domain ports.
#[cfg(feature = "ports")]
pub mod ports;

/// Realtime Soup fan-out service.
#[cfg(feature = "ports")]
pub mod service;
