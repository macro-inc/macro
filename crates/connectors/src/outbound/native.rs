//! Native MCP servers: users connect remote MCP servers directly by URL,
//! signed in to with Macro's own OAuth client, and dialed in process.
//! [`NativeSource`] is the source; the rest is what it is built from.

pub(crate) mod models;
pub(crate) mod oauth;
pub(crate) mod persisting_credential_store;
pub(crate) mod pg_server_repo;
pub(crate) mod ports;
#[cfg(feature = "providers")]
pub(crate) mod provider_registry;
pub(crate) mod redis_state_store;
pub(crate) mod server_access;
pub(crate) mod server_directory;
pub(crate) mod sign_in;
pub(crate) mod source;

#[cfg(test)]
pub(crate) mod memory_store;
