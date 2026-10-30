#![deny(missing_docs)]
//! Session-scoped fan-out of appended agent session log frames.
//!
//! The harness appends each run of frames it stores to a Redis Stream; a
//! process serving viewers over GraphQL reads that stream through a consumer
//! group of its own, hands each run to whoever subscribed to the session, and
//! acknowledges it. No composition root and no tasks are started here.

/// Ports and the fan-out service.
pub mod domain;
/// The Redis Stream publisher and consumer.
#[cfg(feature = "redis")]
pub mod outbound;
