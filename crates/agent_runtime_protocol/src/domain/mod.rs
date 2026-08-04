//! Domain layer: protocol schema, role-oriented connections, and the physical transport port.

/// The ACP-level session identifier.
pub mod acp_id;
/// Caller-facing agent actions and their ACP translation.
pub mod action;
/// A typed duplex channel over the logical protocol stream.
pub mod channel;
/// Role-oriented connections over a logical Agent Runtime Protocol stream.
pub mod connection;
/// The physical transport port.
pub mod ports;
/// Versioned protocol message types.
pub mod schema;
