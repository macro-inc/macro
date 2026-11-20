//! MCP Events webhook subscriptions: an agent connected to Macro's MCP server
//! subscribes a callback URL to Macro events, narrowed by a compiled filter,
//! and the webhook pipeline delivers to it. Same audience as webhooks,
//! personal only. See the README's "MCP event subscriptions".

/// The filter language subscriptions compile into.
pub mod filter;
/// Subscriptions, ids, lifetimes and delivery payloads.
pub mod models;
/// Ports.
pub mod ports;
/// Subscribe, fan-out and delivery services.
pub mod service;
