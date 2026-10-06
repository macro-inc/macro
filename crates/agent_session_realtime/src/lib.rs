#![deny(missing_docs)]
//! Session-scoped fan-out of appended agent session log frames.
//!
//! The harness publishes each run of frames it stores to
//! `macro.agent_session_log`; a process serving viewers over GraphQL consumes
//! that topic here and hands each run to whoever subscribed to the session.
//! No composition root and no tasks are started here.

/// Ports and the fan-out service.
pub mod domain;
/// The Kafka consumer feeding the fan-out.
#[cfg(feature = "consumer")]
pub mod outbound;
