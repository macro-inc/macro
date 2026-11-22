/// [`LinkedGithubTokens`](crate::outbound::native::domain::ports::LinkedGithubTokens) over the authentication service.
pub mod auth_service_github_tokens;
/// Address-guarded HTTP clients for user-chosen MCP servers.
pub mod guarded_http;
/// RMCP-backed OAuth adapter for remote MCP servers.
pub mod oauth;
/// Postgres-backed repository implementing [`McpServerStore`](crate::outbound::native::domain::ports::McpServerStore).
pub mod pg_server_repo;
/// Redis-backed store implementing [`OAuthStateStore`](crate::outbound::native::domain::ports::OAuthStateStore).
pub mod redis_state_store;

/// The native server store hosts read: the Postgres rows, with GitHub's
/// server authorized by the user's account link.
pub type NativeServerStore =
    crate::outbound::native::domain::service::WithLinkedGithub<pg_server_repo::PgServerRepo>;
