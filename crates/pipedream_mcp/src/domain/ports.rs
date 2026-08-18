use super::models::{
    CatalogPage, ConnectToken, MacroUserIdStr, McpServer, PipedreamAccount, PipedreamConnection,
};

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
    /// return only apps that can actually be connected (i.e. apps with an
    /// auth flow).
    fn search(
        &self,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> impl Future<Output = anyhow::Result<CatalogPage>> + Send;
}
