#![deny(missing_docs)]
//! Soup is an amalgamated service which allows callers to query for data by filters and receive many entities of different types

/// Domain models, ports, and service implementation for soup queries.
pub mod domain;
#[cfg(any(feature = "inbound", feature = "ai_tools"))]
/// Inbound HTTP and AI-tool adapters for the soup service.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Outbound persistence adapters for the soup service.
pub mod outbound;
