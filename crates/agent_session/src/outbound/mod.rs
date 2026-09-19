//! Adapters implementing the domain ports for external systems.

pub mod postgres;

/// Haiku-backed automatic session naming.
pub mod name_generator;

/// Streaming a live session's log to a channel's viewers.
pub mod connection_gateway_realtime;
