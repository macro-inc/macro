/// HTTP adapter for the Pipedream API, the app directory, and the remote MCP server.
pub mod api;
/// Macro Connect adapter over `connect_client`: the gateway, token export,
/// catalog, and connect flow.
pub mod connect;
/// One adapter over both backends, dispatching per connection record.
pub mod dispatch;
/// Postgres repository implementing [`ConnectionStore`](crate::domain::ports::ConnectionStore).
pub mod pg_connection_repo;
