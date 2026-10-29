#![deny(missing_docs)]
//! Messages and anchored discussions on channels and documents.

/// Transport-independent message models, policies, and services.
pub mod domain;
/// HTTP and AI tool adapters for the shared message use cases.
#[cfg(any(feature = "inbound", feature = "ai_tools"))]
pub mod inbound;
/// Database and external delivery adapters.
#[cfg(any(feature = "outbound", feature = "broker"))]
pub mod outbound;
