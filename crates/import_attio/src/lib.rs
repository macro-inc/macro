//! Read-only Attio CRM inventory for the reviewed importer in `crates/import`,
//! read through the user's Attio MCP connection.
#![deny(missing_docs)]

/// The workspace's typed records and the read port.
pub mod domain;
/// The fixed tool calls through a user's connected Attio.
pub mod outbound;
/// A labelled Attio MCP stand-in serving synthetic records (feature `standin`).
#[cfg(any(test, feature = "standin"))]
pub mod standin;
