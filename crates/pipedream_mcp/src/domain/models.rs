use rmcp::RoleClient;
use rmcp::model::{ClientInfo, Implementation};
use rmcp::service::RunningService;

pub use macro_user_id::user_id::MacroUserIdStr;

/// Our MCP client publishes this name to servers on-connect.
pub const MCP_CLIENT_NAME: &str = "Macro";

/// A connected MCP server session.
pub type McpServer = RunningService<RoleClient, ClientInfo>;

/// Build the client info sent to MCP servers during initialization.
pub fn client_info() -> ClientInfo {
    ClientInfo::new(
        Default::default(),
        Implementation::new(MCP_CLIENT_NAME, env!("CARGO_PKG_VERSION")),
    )
}

/// An MCP connector a user has connected through Pipedream.
///
/// Pipedream owns the OAuth grant and tokens for the connected account; we
/// store only which app the user connected and the Pipedream account ID the
/// grant lives under.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PipedreamConnection {
    /// The user who connected the app.
    pub user_id: MacroUserIdStr<'static>,
    /// Pipedream app name slug, e.g. `linear` or `notion`.
    pub app_slug: String,
    /// Human-readable display name, e.g. `Linear`.
    pub server_name: String,
    /// The Pipedream connected-account ID holding the grant.
    pub account_id: String,
    /// Whether the connector is enabled for tool use.
    pub enabled: bool,
}

/// A short-lived token for opening Pipedream's hosted Connect UI.
#[derive(Clone, Debug)]
pub struct ConnectToken {
    /// The Connect token itself.
    pub token: String,
    /// RFC 3339 expiry of the token.
    pub expires_at: String,
    /// Shareable link that opens the same connect flow in a browser tab.
    pub connect_link_url: String,
}

/// A connected account as reported by Pipedream.
#[derive(Clone, Debug)]
pub struct PipedreamAccount {
    /// Pipedream's connected-account ID (`apn_...`).
    pub id: String,
    /// The external user ID the account was connected for (our user ID).
    pub external_user_id: Option<String>,
    /// The app the account belongs to (name slug, e.g. `linear`).
    pub app_slug: String,
    /// Human-readable app name, e.g. `Linear`.
    pub app_name: String,
    /// Whether Pipedream considers the account's credentials healthy.
    pub healthy: bool,
}

/// One connectable app advertised in the catalog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogEntry {
    /// Pipedream app name slug, e.g. `linear` — what gets connected.
    pub app_slug: String,
    /// Human-readable name to display, e.g. `Linear`.
    pub display_name: String,
    /// One-line description of what connecting the app enables.
    pub description: Option<String>,
    /// URL of the app's icon, when the directory provides one.
    pub icon_url: Option<String>,
    /// Whether this is a curated priority connector, ranked above organic
    /// directory results (and renderable as its own section).
    pub priority: bool,
}

/// One page of catalog results.
#[derive(Clone, Debug, Default)]
pub struct CatalogPage {
    /// The entries on this page, in display order.
    pub entries: Vec<CatalogEntry>,
    /// Opaque cursor for fetching the next page. `None` on the last page.
    pub next_cursor: Option<String>,
}

/// Errors from Pipedream MCP tool dispatch.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The requested tool was not found on any connected server.
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    /// A tool invocation failed.
    #[error("tool call failed: {0}")]
    ToolCall(String),
}
