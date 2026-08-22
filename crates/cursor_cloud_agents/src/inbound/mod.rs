//! Inbound adapters — the transports a client drives this agent through.

/// The ACP adapter: newline-delimited JSON-RPC frames over any reader/writer.
pub mod acp;
