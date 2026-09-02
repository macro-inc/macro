#![deny(missing_docs)]
#![doc = include_str!("../README.md")]

/// Domain models, ports, and services.
pub mod domain;
#[cfg(any(feature = "inbound", feature = "consumer", feature = "worker"))]
/// HTTP, Kafka consumer, and queue worker adapters.
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "stream"))]
/// Postgres, HTTP, and Kafka stream adapters.
pub mod outbound;
#[cfg(any(feature = "consumer", feature = "stream"))]
/// Broker topics shared by every webhook consumption path.
pub mod topics;
