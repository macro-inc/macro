//! Outbound adapters for external services.
//!
//! These modules contain implementations of the domain ports that connect
//! to external services like Redis, PostgreSQL, WebSocket gateways, etc.

pub mod email;
pub mod mobile;
pub mod queue;
pub mod rate_limit;
pub mod repository;
pub mod websocket;
