//! Inbound adapters: the HTTP API (agent CRUD, posting ACP messages, and the
//! runtime WebSocket endpoint) and the carrier-agnostic driver that pumps
//! accepted runtime connections into the domain.

pub mod http;
pub mod runtime;
