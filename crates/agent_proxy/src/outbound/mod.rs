//! Outbound adapters: the live-session registry, the connection gateway
//! notifier, and the pending-message queue.
//!
//! Each implements a port in [`crate::domain::ports`]. The runtime WebSocket
//! endpoint is *not* here despite carrying runtime traffic: it accepts
//! connections rather than implementing anything the domain calls, so it
//! lives in [`crate::inbound::http`]. What the domain
//! calls to reach a runtime is [`runtime_registry`], which does implement a
//! port.

pub mod gateway;
pub mod pending_messages;
pub mod runtime_registry;
