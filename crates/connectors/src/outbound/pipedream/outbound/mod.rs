/// HTTP adapter for the Pipedream API, the app directory, and the remote MCP server.
pub mod api;
/// Macro Connect behind the old ports, over [`crate::outbound::macro_connect`].
pub mod connect;
/// Transitional: one adapter over both backends for the old hosts.
pub mod dispatch;
/// Postgres repository implementing [`ConnectionStore`](crate::outbound::pipedream::domain::ports::ConnectionStore).
pub mod pg_connection_repo;
