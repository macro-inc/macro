//! Outbound adapters: the live-session registry, the connection gateway
//! notifier, and the pending-message queue.

pub mod gateway;
pub mod pending_messages;
pub mod runtime_registry;
pub mod shared_runtime_connections;
