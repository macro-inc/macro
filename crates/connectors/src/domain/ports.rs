//! What the domain needs from each source, from the flag and from the
//! overlay table. Nothing here leaves the crate.
//!
//! `Source`, `McpConnection` and `ApiConnection` use `#[async_trait]`
//! because they must be object-safe: one user's answer holds connections
//! from four different sources side by side (`Arc<dyn McpConnection>`), and
//! the service walks every source in one list (`Arc<dyn Source>`).

use crate::domain::catalog::Overlays;
use crate::domain::discovery::OrgSetup;
use crate::domain::models::{
    AddedBy, ApiRequest, ApiResponse, ConnectStep, ConnectorId, ConnectorKey, ServerUrl, Surfaces,
    Upstream,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::McpServer;
use std::collections::HashMap;
use std::sync::Arc;

/// Which source holds a connection. Only the resolver reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SourceKind {
    /// Servers dialed directly with Macro's own OAuth client (`mcp_servers`).
    Native,
    /// GitHub, authorized by the user's Macro account link.
    GithubLink,
    /// Pipedream Connect (`pipedream_mcp_connections`, provider `pipedream`).
    Pipedream,
    /// Macro Connect (`pipedream_mcp_connections`, provider `connect`).
    Connect,
}

/// One connection a source holds for a user, with what it provides.
#[derive(Clone)]
pub(crate) struct SourceConnection {
    /// The source holding it.
    pub(crate) source: SourceKind,
    /// The app it is to, or for a native row always the server's URL: the
    /// resolver decides whether that URL is an app (rule 5).
    pub(crate) key: ConnectorKey,
    /// The source's own identifier for it (the stored app slug, the URL as
    /// typed). Breaks ties between two connections to one app, so the answer
    /// never depends on row order.
    pub(crate) source_id: String,
    /// The display name.
    pub(crate) name: String,
    /// Whether the user has it turned on.
    pub(crate) enabled: bool,
    /// What it holds to sign in with.
    pub(crate) grant: GrantState,
    /// MCP access, when the source provides it for this app.
    pub(crate) mcp: Option<Arc<dyn McpConnection>>,
    /// API access, when the source provides it for this app.
    pub(crate) api: Option<Arc<dyn ApiConnection>>,
}

impl std::fmt::Debug for SourceConnection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SourceConnection")
            .field("source", &self.source)
            .field("key", &self.key)
            .field("source_id", &self.source_id)
            .field("enabled", &self.enabled)
            .field("grant", &self.grant)
            .field("mcp", &self.mcp.is_some())
            .field("api", &self.api.is_some())
            .finish_non_exhaustive()
    }
}

/// What a connection holds to sign in with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GrantState {
    /// A grant that works, as far as the source can tell without asking the
    /// vendor.
    Working,
    /// No grant at all: a server added by URL and never signed in to. Such a
    /// server may take anonymous requests; an app never does.
    Missing,
    /// A grant known not to work (a GitHub link whose token GitHub refuses,
    /// a native sign-in that never finished, an expired token with nothing
    /// to refresh it): only the user authorizing again mends it.
    Dead,
}

/// Why a source refused an operation, carried as the context of the
/// operation's report so the service answers with the matching
/// [`ConnectorsError`](crate::domain::models::ConnectorsError) rather than an
/// internal error.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum SourceRefusal {
    /// The source holds no connection to this key for the user.
    #[error("the source holds no connection to {0}")]
    NotFound(ConnectorKey),
    /// The connection's grant no longer works; only the user authorizing
    /// again mends it.
    #[error("the connection to {0} must be authorized again")]
    NeedsReauth(ConnectorKey),
    /// The source does not serve this key at all.
    #[error("this source does not serve {0}")]
    Unsupported(ConnectorKey),
    /// An agent tried to add a server that is not public `https`.
    #[error("`{0}` is not a public https URL")]
    NonPublic(ServerUrl),
    /// A server's display name is empty.
    #[error("the name is empty")]
    EmptyName,
}

/// One place a user's connections live.
#[async_trait::async_trait]
pub(crate) trait Source: Send + Sync {
    /// Which source this is.
    fn kind(&self) -> SourceKind;

    /// The user's connections held by this source, each with what it
    /// provides, enabled or not.
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, rootcause::Report>;

    /// Whether this source serves an app, and with which surfaces.
    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, rootcause::Report>;

    /// The setup an admin of the user's organization must do at the vendor
    /// before each of `apps` connects through this source; an app with none
    /// is left out.
    async fn org_setups(
        &self,
        _apps: &[ConnectorId],
    ) -> Result<HashMap<ConnectorId, OrgSetup>, rootcause::Report> {
        Ok(HashMap::new())
    }

    /// Every user with an enabled connection to `app` here: the candidates a
    /// background sync resolves one by one.
    async fn holders(
        &self,
        app: &ConnectorId,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>;

    /// How to reach `app` for a user who holds no usable connection to it
    /// here, when this source can address them anyway: one that scopes a
    /// call by user and app, so listing the app's tools works and calling
    /// one fails until they connect. `None` for a source that needs the
    /// user's own connection to reach the app at all.
    async fn address_unconnected(
        &self,
        _user: &MacroUserIdStr<'static>,
        _app: &ConnectorId,
    ) -> Result<Option<Upstream>, rootcause::Report> {
        Ok(None)
    }

    /// Begin connecting `key` for the user: an app, or signing in to a
    /// server added by URL.
    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, rootcause::Report>;

    /// Record the connection the user just finished making to `app`.
    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, rootcause::Report>;

    /// Turn the user's connection to `key` on or off.
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), rootcause::Report>;

    /// Rename the user's connection to `key`.
    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), rootcause::Report>;

    /// Remove the user's connection to `key`, revoking it where the source
    /// can (removing GitHub unlinks the account).
    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), rootcause::Report>;
}

/// A connection that serves MCP.
#[async_trait::async_trait]
pub(crate) trait McpConnection: Send + Sync {
    /// Open an MCP session in process, for chat and in-process agents.
    /// Credentials refreshed while connecting are persisted by the source.
    /// A grant that no longer works fails with [`SourceRefusal::NeedsReauth`].
    async fn dial(&self) -> Result<McpServer, rootcause::Report>;

    /// The address and credential the egress proxy stamps onto a sandbox's
    /// request, refreshed if it was about to expire. A grant that no longer
    /// works fails with [`SourceRefusal::NeedsReauth`].
    async fn upstream(&self) -> Result<Upstream, rootcause::Report>;
}

/// A connection that can call its app's REST API.
#[async_trait::async_trait]
pub(crate) trait ApiConnection: Send + Sync {
    /// Send `request` with the connection's credentials. A non-2xx answer is
    /// a response, not an error.
    async fn call(&self, request: ApiRequest) -> Result<ApiResponse, rootcause::Report>;
}

/// The Macro Connect rollout flag for a user. Read in one place only, through one
/// cache; the resolver counts a failed read as off (rule 9).
pub(crate) trait MacroConnectEnabledFlagReader: Send + Sync + 'static {
    /// Whether the flag is on for `user`.
    fn read(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// The `mcp_overlays` table: catalog apps served by the vendor's own MCP
/// server through the native source.
pub(crate) trait OverlayCatalog: Send + Sync + 'static {
    /// Every overlaid app with its server.
    fn overlays(&self) -> impl Future<Output = Result<Overlays, rootcause::Report>> + Send;
}

/// Adding servers by URL. Only the native source holds them.
///
/// Object-safe (`#[async_trait]`): the service holds it as
/// `Arc<dyn ServerDirectory>` so its type names no adapter.
#[async_trait::async_trait]
pub(crate) trait ServerDirectory: Send + Sync {
    /// Add `url` for the user, enabled and not yet signed in to, or return
    /// the row the user already has there. An agent may add only public
    /// `https` destinations; refusing one answers
    /// [`SourceRefusal::NonPublic`], and an empty name
    /// [`SourceRefusal::EmptyName`].
    async fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: &ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> Result<SourceConnection, rootcause::Report>;
}
