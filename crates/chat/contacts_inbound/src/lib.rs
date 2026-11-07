//! HTTP handlers (feature `axum`) and the SQS worker (feature `worker`) that
//! drive `contacts_core`'s service.

#![deny(missing_docs)]

/// HTTP handlers, router, DTOs, and swagger definitions.
#[cfg(feature = "axum")]
pub mod http;
/// SQS message parsing and worker.
#[cfg(feature = "worker")]
pub mod worker;
