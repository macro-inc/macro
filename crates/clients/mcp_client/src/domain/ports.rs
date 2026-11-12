use super::models::{MacroUserIdStr, McpServer, McpServerRecord, RefusedAddress};
use rmcp::transport::auth::{AuthError, AuthorizationManager};
use rmcp::transport::streamable_http_client::StreamableHttpClient;
use std::sync::Arc;
use url::Url;

/// Port for the address-guarded HTTP clients every connection to a user's
/// MCP server goes through.
pub trait McpServerHttp: Send + Sync {
    /// The HTTP client the MCP transport runs on.
    type Transport: StreamableHttpClient + Sync;

    /// Refuse `url` if its host is an IP literal the address policy does not
    /// allow. Named hosts are checked when they resolve.
    fn check_url(&self, url: &Url) -> Result<(), RefusedAddress>;

    /// The client for the MCP transport. It follows only same-origin 307/308
    /// redirects and has no overall timeout, since event streams stay open
    /// for as long as a tool call runs.
    fn transport(&self) -> Self::Transport;

    /// An rmcp authorization manager for `server_url` whose OAuth requests go
    /// through the guarded clients.
    fn authorization_manager(
        &self,
        server_url: &str,
    ) -> impl Future<Output = Result<AuthorizationManager, AuthError>> + Send;
}

/// Port for persisting MCP server records, keyed by user.
pub trait McpServerStore: Send + Sync + 'static {
    /// Error type for store operations.
    type Err: Send + std::fmt::Debug;

    /// Persist a server record, overwriting any existing entry for the same user and URL.
    fn save(&self, record: &McpServerRecord) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Load a server record for a user and server URL. Returns `None` if not stored.
    fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> impl Future<Output = Result<Option<McpServerRecord>, Self::Err>> + Send;

    /// Delete a server record for a user and server URL.
    fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// List all stored server records for a user.
    fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<McpServerRecord>, Self::Err>> + Send;
}

/// Port for establishing a connection to an MCP server.
pub trait McpConnector: Send + Sync {
    /// Connect to the MCP server described by this value.
    ///
    /// Credential updates produced while connecting — and later, while the
    /// connection is in use (e.g. refreshed OAuth tokens) — are persisted
    /// through `server_store`.
    fn connect<S: McpServerStore>(
        &self,
        http: &impl McpServerHttp,
        server_store: Arc<S>,
    ) -> impl Future<Output = anyhow::Result<McpServer>> + Send;
}

/// Everything needed to resume the OAuth flow on callback.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PendingAuth {
    /// PKCE verifier generated during authorization start.
    pub pkce_verifier: String,
    /// OAuth client ID obtained during dynamic registration.
    pub client_id: String,
    /// OAuth client secret, if the server issued one.
    pub client_secret: Option<String>,
    /// The user who initiated the flow.
    pub user_id: String,
    /// The MCP server URL being authorized.
    pub server_url: String,
    /// Human-readable server name.
    pub server_name: String,
}

/// Port for storing ephemeral OAuth state across requests.
///
/// Implementations must support cross-instance access (e.g. Redis) and
/// should expire entries after a reasonable TTL.
pub trait OAuthStateStore: Send + Sync + 'static {
    /// Save a pending authorization, keyed by CSRF state token.
    fn save(
        &self,
        csrf_token: &str,
        pending: PendingAuth,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Load and remove a pending authorization by CSRF state token.
    fn take(
        &self,
        csrf_token: &str,
    ) -> impl Future<Output = anyhow::Result<Option<PendingAuth>>> + Send;
}

/// Port for driving the OAuth authorization-code flow for an MCP server.
///
/// Implementations manage the full PKCE handshake: discovering server metadata,
/// registering a client, building the authorization URL, and exchanging the
/// callback code for tokens.
pub trait OAuthClient: Send + Sync + 'static {
    /// Begin the OAuth flow for `server_url`.
    ///
    /// Discovers the server's OAuth metadata, registers a dynamic client if
    /// needed, and returns the authorization URL the user should be redirected to.
    fn start_authorization(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
        server_name: &str,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Complete the OAuth flow using the `code` and `state` returned by the
    /// authorization server's redirect.
    ///
    /// Exchanges the authorization code for tokens, persists them, and
    /// returns the saved server record (user, url, credentials).
    fn exchange_authorization_code(
        &self,
        code: &str,
        state: &str,
    ) -> impl Future<Output = anyhow::Result<McpServerRecord>> + Send;
}

/// The GitHub token from a user's Macro account link.
///
/// Object-safe (`async_trait`) so hosts without the link wire nothing and the
/// decorated store's type stays the same everywhere.
#[async_trait::async_trait]
pub trait LinkedGithubTokens: Send + Sync + 'static {
    /// The user's working link token; `None` when they never linked or the
    /// token stopped working.
    async fn access_token(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<String>>;
}
