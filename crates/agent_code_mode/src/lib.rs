//! Session-bound code execution, SDK discovery, and durable tool-rendering records.
#![deny(missing_docs)]

/// Execution policy and replaceable capabilities.
pub mod domain;
/// Thin MCP tool and authorized HTTP read adapters.
pub mod inbound;
/// Toolset dispatch and PostgreSQL persistence.
pub mod outbound;
