//! Native MCP servers: users connect remote MCP servers directly, over
//! OAuth (or a linked account), and the AI loop dials them in process.

/// Domain layer: models, ports, and service.
pub mod domain;

/// Inbound adapters (HTTP/axum).
pub mod inbound;

/// Outbound adapters for OAuth, Postgres, and Redis.
pub mod outbound;

/// The native source behind the connectors `Source` port.
mod source;
pub(crate) use source::NativeSource;
pub(crate) use source::is_github;

/// Finishing a sign-in to a server by URL, for the OAuth callback route.
pub(crate) mod sign_in;

#[cfg(test)]
pub(crate) mod memory_store;
