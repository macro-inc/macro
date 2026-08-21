#![deny(missing_docs)]
//! Agent Runtime Protocol wire types.
//!
//! The Agent Runtime Protocol is the outer protocol used to communicate with
//! an agent runtime. It carries Agent Client Protocol (ACP) messages alongside
//! runtime control messages without interpreting the wrapped ACP payloads.

/// Protocol schema, role-oriented connections, and the runtime wire port.
pub mod domain;
/// Adapters implementing the domain wire port over physical transports.
#[cfg(feature = "transport")]
pub mod outbound;

/// Utilities for asserting direction-labelled JSON messages at the wire boundary.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
