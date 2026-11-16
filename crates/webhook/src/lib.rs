#![deny(missing_docs)]
#![doc = include_str!("../README.md")]

/// Domain models, ports, and services.
pub mod domain;
#[cfg(any(feature = "inbound", feature = "consumer", feature = "worker"))]
/// HTTP, Kafka consumer, and queue worker adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres, HTTP, and SQS adapters.
pub mod outbound;
#[cfg(feature = "consumer")]
/// Broker topics carrying public events.
pub mod topics;
