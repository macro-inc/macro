//! Domain layer: protocol schema, role-oriented connections, and the physical transport port.

/// Caller-facing agent actions and their ACP translation.
pub mod action;
/// A typed duplex channel over the logical protocol stream.
#[cfg(feature = "transport")]
pub mod channel;
/// Role-oriented connections over a logical Agent Runtime Protocol stream.
#[cfg(feature = "transport")]
pub mod connection;
/// The physical transport port.
pub mod ports;
/// Versioned protocol message types.
pub mod schema;
/// The log frame an MCP tool call held for the owner's approval leaves.
pub mod tool_approval;

/// Agent-neutral reconstructed turn lifecycle.
pub mod turn;
