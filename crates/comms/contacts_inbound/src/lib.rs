//! HTTP handlers (feature `axum`) and the SQS worker (feature `worker`) that
//! drive `contacts_core`'s service.

#![deny(missing_docs)]

/// HTTP handlers, router, DTOs, and swagger definitions.
#[cfg(feature = "axum")]
pub mod http;
/// Kafka consumer fanning out `user.picture_changed` to contacts.
#[cfg(feature = "picture-fanout")]
pub mod user_picture_consumer;
/// SQS message parsing and worker.
#[cfg(feature = "worker")]
pub mod worker;
