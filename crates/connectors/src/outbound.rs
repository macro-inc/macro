/// The catalog's directory over the hosted app directory.
pub(crate) mod app_directory;

/// The native stack: MCP servers users connect to directly.
pub mod native;

/// The hosted stack: apps users connect through Pipedream or Macro Connect.
pub mod pipedream;

/// GitHub, connected by the user's Macro account link.
pub(crate) mod github_link;
/// The table both hosted sources keep their connections in.
pub(crate) mod hosted_connections;
/// Macro Connect as a source of connections.
pub(crate) mod macro_connect;
/// The overlay table, for the domain's catalog.
pub(crate) mod overlays;
