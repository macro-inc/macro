//! Stateful MCP routing. Only the owning process can resume pending JSON-RPC calls.
pub(crate) mod directory;
mod http;
mod redis;

pub(crate) use http::route_sessions;
pub(crate) use redis::{RedisDirectory, replica_address};
