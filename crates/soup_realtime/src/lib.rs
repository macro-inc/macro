#![deny(missing_docs)]
//! User-scoped realtime Soup fan-out components.
//!
//! The crate exposes domain orchestration plus optional Kafka and infrastructure
//! adapters. It intentionally contains no composition root and starts no tasks.

/// Domain models, ports, and fan-out orchestration.
pub mod domain;

/// Inbound transport adapters.
#[cfg(feature = "consumer")]
pub mod inbound;

/// Outbound infrastructure adapters.
#[cfg(any(feature = "consumer", feature = "outbound"))]
pub mod outbound;
