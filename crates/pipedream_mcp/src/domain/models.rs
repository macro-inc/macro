pub use macro_user_id::user_id::MacroUserIdStr;
pub use mcp_toolset::{MCP_CLIENT_NAME, McpServer, client_info};

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
pub use mcp_toolset::Error;

/// HTTP methods the Connect API proxy forwards upstream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProxyMethod {
    /// `GET`
    Get,
    /// `POST`
    Post,
}

/// A request to a connected app's own API, sent through Pipedream Connect's
/// API proxy with the connected account's credentials attached upstream.
#[derive(Clone, Debug, PartialEq)]
pub struct ProxyRequest {
    /// The HTTP method to use upstream.
    pub method: ProxyMethod,
    /// The absolute upstream URL, e.g. `https://api.notion.com/v1/search`.
    pub url: String,
    /// Upstream headers, by their upstream names (e.g. `Notion-Version`).
    /// The proxy adapter forwards them under its own header prefix.
    pub headers: Vec<(String, String)>,
    /// JSON body, when the upstream call takes one.
    pub body: Option<serde_json::Value>,
}

impl ProxyRequest {
    /// A `GET` of `url` with no headers.
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            method: ProxyMethod::Get,
            url: url.into(),
            headers: Vec::new(),
            body: None,
        }
    }

    /// A `POST` of `body` as JSON to `url`.
    pub fn post_json(url: impl Into<String>, body: serde_json::Value) -> Self {
        Self {
            method: ProxyMethod::Post,
            url: url.into(),
            headers: Vec::new(),
            body: Some(body),
        }
    }

    /// Add an upstream header.
    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

/// The upstream response relayed by the proxy. Non-2xx statuses are
/// responses, not errors: the caller owns the upstream API's semantics.
#[derive(Clone, Debug, PartialEq)]
pub struct ProxyResponse {
    /// HTTP status code.
    pub status: u16,
    /// Delay requested by a `Retry-After` header, when present.
    pub retry_after: Option<std::time::Duration>,
    /// Raw response body.
    pub body: Vec<u8>,
}

impl ProxyResponse {
    /// Whether the status is 2xx.
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Decode the body as JSON.
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_slice(&self.body)
    }
}

/// Errors sending a request through the Connect API proxy.
#[derive(Debug, thiserror::Error)]
pub enum ConnectProxyError {
    /// The user has no Pipedream connection for the app.
    #[error("{app_slug} is not connected through Pipedream")]
    NotConnected {
        /// The app slug that was requested.
        app_slug: String,
    },
    /// This deployment has no Pipedream credentials.
    #[error("Pipedream is not configured")]
    NotConfigured,
    /// Any other transport or Pipedream failure.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}
