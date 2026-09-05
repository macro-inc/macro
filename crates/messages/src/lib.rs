#![deny(missing_docs)]
//! Messages and anchored discussions on channels, documents, and email threads.

/// Transport-independent message models, policies, and services.
pub mod domain;
/// HTTP adapters for the shared message use cases.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Database and external delivery adapters.
#[cfg(feature = "outbound")]
pub mod outbound;
