//! The outbound adapters: one module per source of connections, each
//! implementing the domain's `Source` port, plus the tables, directory and
//! HTTP client they share. Nothing here is visible outside the crate except
//! the address-guarded HTTP client the crate root re-exports.

/// The catalog's directory over the hosted app directory.
pub(crate) mod app_directory;
/// GitHub, connected by the user's Macro account link.
pub(crate) mod github_link;
/// Address-guarded HTTP clients for user-chosen servers.
pub mod guarded_http;
/// The table both hosted sources keep their connections in.
pub(crate) mod hosted_connections;
/// Macro Connect as a source of connections.
pub(crate) mod macro_connect;
/// MCP servers users connect to directly by URL.
pub(crate) mod native;
/// REST apps Macro signs in to with its own OAuth client (Autodesk).
pub(crate) mod native_api;
/// The overlay table, for the domain's catalog.
pub(crate) mod overlays;
/// Pipedream as a source of connections.
pub(crate) mod pipedream;
