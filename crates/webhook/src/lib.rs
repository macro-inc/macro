#![deny(missing_docs)]
#![doc = include_str!("../README.md")]

/// Domain models, ports, and services.
pub mod domain;
#[cfg(any(feature = "inbound", feature = "consumer", feature = "worker"))]
/// HTTP, Kafka consumer, and queue worker adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres and HTTP adapters.
pub mod outbound;
