use super::models::{
    CatalogEntry, CatalogPage, ConnectToken, MacroUserIdStr, McpServer, PipedreamAccount,
    PipedreamConnection,
};

/// Cross-user lookup for background integrations that follow a connected app.
pub trait AppConnections: Send + Sync + 'static {
    /// Every user's enabled connection to `app_slug`.
    fn list_enabled_for_app(
        &self,
        app_slug: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<PipedreamConnection>>> + Send;
}

/// Port for persisting Pipedream-connected apps, keyed by user and app slug.
pub trait ConnectionStore: Send + Sync + 'static {
    /// Error type for store operations.
    type Err: Send + std::fmt::Debug;

    /// Persist a record, overwriting any existing entry for the same user and app.
    fn save(
        &self,
        record: &PipedreamConnection,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Load a record for a user and app slug. Returns `None` if not stored.
    fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> impl Future<Output = Result<Option<PipedreamConnection>, Self::Err>> + Send;

    /// Delete a record for a user and app slug.
    fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// List all stored records for a user.
    fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<PipedreamConnection>, Self::Err>> + Send;
}

/// Port for opening a live MCP connection for a connected app.
///
/// The single implementation connects to Pipedream's remote MCP server,
/// scoped to the record's user and app; Pipedream injects the account's
/// credentials server-side, so no tokens ever pass through here.
pub trait McpConnection: Send + Sync + 'static {
    /// Whether this deployment has the configuration needed to connect.
    fn is_configured(&self) -> bool;

    /// Connect to the MCP server serving `record`'s app for `record.user_id`.
    fn connect(
        &self,
        record: &PipedreamConnection,
    ) -> impl Future<Output = anyhow::Result<McpServer>> + Send;
}

/// An unconfigured deployment: `None` connects nothing, so toolsets built
/// before Pipedream is configured degrade to empty instead of erroring at
/// composition time.
impl<P: McpConnection> McpConnection for Option<std::sync::Arc<P>> {
    fn is_configured(&self) -> bool {
        self.as_ref()
            .is_some_and(|connection| connection.is_configured())
    }

    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        match self {
            Some(connection) => connection.connect(record).await,
            None => anyhow::bail!("Pipedream is not configured"),
        }
    }
}

/// Port for Pipedream Connect: managed auth for MCP connectors.
///
/// Pipedream owns the whole account lifecycle — the consent flow (hosted
/// Connect UI), credential storage, and token refresh. The domain only ever
/// sees short-lived Connect tokens and account metadata.
pub trait PipedreamConnect: Send + Sync + 'static {
    /// Create a short-lived Connect token for `external_user_id` (our user
    /// ID), used by the frontend to open the hosted Connect UI.
    fn create_connect_token(
        &self,
        external_user_id: &str,
    ) -> impl Future<Output = anyhow::Result<ConnectToken>> + Send;

    /// Fetch a connected account's metadata. Returns `None` if Pipedream
    /// doesn't know the account ID.
    fn get_account(
        &self,
        account_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<PipedreamAccount>>> + Send;

    /// Delete a connected account from Pipedream (revoking our copy of the
    /// grant).
    fn delete_account(&self, account_id: &str) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Port for browsing the directory of connectable apps.
pub trait ConnectorDirectory: Send + Sync + 'static {
    /// Search the directory.
    ///
    /// `search` filters apps by name; `None` browses everything. `cursor` is
    /// the opaque pagination cursor from a previous page. Implementations
    /// return entries most-popular-first, and only apps that can actually be
    /// connected and used (i.e. apps with an auth flow and at least one
    /// action to expose as a tool).
    fn search(
        &self,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> impl Future<Output = anyhow::Result<CatalogPage>> + Send;

    /// Look up one app by its name slug.
    ///
    /// `Ok(None)` when Pipedream has no connectable app under that exact slug:
    /// unknown, or an app with no auth flow (nothing to connect). A lookup
    /// that cannot be completed is an error, not a miss.
    fn retrieve(
        &self,
        app_slug: &str,
    ) -> impl Future<Output = anyhow::Result<Option<CatalogEntry>>> + Send;
}

/// Read an app's advertised capabilities without invoking any of its tools.
pub trait ConnectorCapabilities: Send + Sync + 'static {
    /// List tools, including for apps this user has not connected yet.
    fn tools(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<super::service::discovery::ConnectorTool>>> + Send;
}

/// A connected app's answer, relayed through the proxy whatever its status.
/// Never log the body: some apps return secrets (webhook registration).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProxyResponse {
    /// The HTTP status.
    pub status: http::StatusCode,
    /// The app's response headers.
    pub headers: http::HeaderMap,
    /// The response body.
    pub body: String,
}

impl ProxyResponse {
    /// How long the app asked callers to wait, from a `Retry-After` header
    /// in seconds.
    pub fn retry_after(&self) -> Option<std::time::Duration> {
        self.headers
            .get(http::header::RETRY_AFTER)?
            .to_str()
            .ok()?
            .trim()
            .parse()
            .ok()
            .map(std::time::Duration::from_secs)
    }
}

/// Port for calling a connected app's own API with the account's
/// credentials, which Pipedream injects server-side.
pub trait ConnectedAppProxy: Send + Sync + 'static {
    /// Send a request to the connected app's API on behalf of `connection`'s
    /// account.
    ///
    /// `url` is absolute (e.g. `https://api.notion.com/v1/search`).
    /// `headers` are upstream headers, never `Authorization`. A non-2xx
    /// answer from the app is a response, not an error, so callers can read
    /// its status and back off.
    fn proxy(
        &self,
        connection: &PipedreamConnection,
        method: http::Method,
        url: &str,
        headers: &http::HeaderMap,
        body: Option<&serde_json::Value>,
    ) -> impl Future<Output = anyhow::Result<ProxyResponse>> + Send;
}
