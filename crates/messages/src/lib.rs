#![deny(missing_docs)]
//! Messages and anchored discussions on channels and documents.

/// Transport-independent message models, policies, and services.
pub mod domain;
/// HTTP adapters for the shared message use cases.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Database and external delivery adapters.
#[cfg(any(feature = "outbound", feature = "broker"))]
pub mod outbound;
