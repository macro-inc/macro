//! The public types of the connectors crate.
//!
//! None of them names a source. Handles and [`Permitted`] have no public
//! constructor and cannot be deserialized: the resolver is the only code that
//! builds them, so holding one is proof that the rules allow its use.

use crate::domain::catalog;
use crate::domain::ports::{ApiConnection, McpConnection};
use ai_toolset::{
    RequestContext, RequestSchema, SearchableTool, ToolCallFuture, ToolInfo, ToolSet,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::RemoteMcpToolSet;
use std::fmt;
use std::sync::Arc;
use url::Url;

#[cfg(test)]
mod test;

/// An app's identity in the catalog: its Pipedream app slug, with aliases
/// folded so that `slack` and `slack_v2` are one app.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ConnectorId(String);

/// A string that is not an app slug.
#[derive(Debug, thiserror::Error)]
#[error("`{0}` is not an app slug")]
pub struct InvalidConnectorId(String);

impl ConnectorId {
    /// Accept an app slug, folding aliases to the app they name.
    ///
    /// Rejects rather than repairs: a slug that is "cleaned up" into another
    /// valid slug names an app other than the one asked for.
    pub fn parse(slug: &str) -> Result<Self, InvalidConnectorId> {
        let valid = !slug.is_empty()
            && slug.chars().all(|character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || character == '_'
                    || character == '-'
            });
        if !valid {
            return Err(InvalidConnectorId(slug.to_owned()));
        }

        Ok(Self(catalog::canonical_slug(slug).to_owned()))
    }

    /// GitHub, the one app a Macro account link can connect.
    pub(crate) fn github() -> Self {
        Self(catalog::GITHUB_SLUG.to_owned())
    }

    /// The canonical slug.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ConnectorId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// An MCP server's address, normalized once so that two spellings of one
/// server compare equal.
///
/// A trailing slash does not change which server a URL names, so it is
/// dropped; the scheme and host are lowercased by URL parsing. The stored row
/// keeps the user's own spelling; this is only for identity.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ServerUrl(String);

/// A string that is not an absolute `http` or `https` URL.
#[derive(Debug, thiserror::Error)]
#[error("`{0}` is not an http(s) URL")]
pub struct InvalidServerUrl(String);

impl ServerUrl {
    /// Parse and normalize a server address.
    pub fn parse(url: &str) -> Result<Self, InvalidServerUrl> {
        let url = url.trim();
        let parsed = match Url::parse(url) {
            Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => parsed,
            _ => return Err(InvalidServerUrl(url.to_owned())),
        };

        Ok(Self(parsed.as_str().trim_end_matches('/').to_owned()))
    }

    /// The normalized address.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ServerUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// What a connection is to: a catalog app, or a server added by URL.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ConnectorKey {
    /// A catalog app.
    App(ConnectorId),
    /// A server the user added by URL.
    Server(ServerUrl),
}

impl From<ConnectorId> for ConnectorKey {
    fn from(app: ConnectorId) -> Self {
        Self::App(app)
    }
}

impl From<ServerUrl> for ConnectorKey {
    fn from(url: ServerUrl) -> Self {
        Self::Server(url)
    }
}

impl fmt::Display for ConnectorKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::App(app) => app.fmt(formatter),
            Self::Server(url) => url.fmt(formatter),
        }
    }
}

/// Where a user stands with an app or server.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Status {
    /// Usable.
    Connected,
    /// The user turned it off.
    Disabled,
    /// The user holds it, but its grant no longer works.
    NeedsReauth,
    /// Nothing usable: never connected, or held only through a source the
    /// rules ignore for this user.
    NotConnected,
}

/// What a connection can be used as.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Surfaces {
    mcp: bool,
    api: bool,
}

impl Surfaces {
    /// Surfaces with MCP and API access as given.
    pub(crate) const fn new(mcp: bool, api: bool) -> Self {
        Self { mcp, api }
    }

    /// Whether it provides MCP tools.
    pub fn mcp(&self) -> bool {
        self.mcp
    }

    /// Whether it provides the app's REST API.
    pub fn api(&self) -> bool {
        self.api
    }
}

/// What the user must do next to connect.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectStep {
    /// Open this page in the browser.
    OpenUrl(Url),
    /// Open the embedded connect dialog with this short-lived token.
    EmbeddedDialog {
        /// The token the dialog opens with.
        token: String,
        /// RFC 3339 expiry of the token.
        expires_at: String,
        /// A page that opens the same flow in a browser tab.
        link: Url,
    },
}

/// Who is adding a server by URL, which decides the destinations allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddedBy {
    /// The user, in settings.
    User,
    /// An agent acting for the user. Macro later connects to the URL, so an
    /// agent may only add public `https` destinations.
    Agent,
}

/// One app or server as the web shows it. It never says which source holds
/// the connection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connector {
    key: ConnectorKey,
    name: String,
    status: Status,
    connectable: bool,
    surfaces: Surfaces,
}

impl Connector {
    /// A connector as the service reports it.
    pub(crate) fn new(
        key: ConnectorKey,
        name: String,
        status: Status,
        connectable: bool,
        surfaces: Surfaces,
    ) -> Self {
        Self {
            key,
            name,
            status,
            connectable,
            surfaces,
        }
    }

    /// The app or server.
    pub fn key(&self) -> &ConnectorKey {
        &self.key
    }

    /// Its display name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Where the user stands with it.
    pub fn status(&self) -> Status {
        self.status
    }

    /// Whether the user can connect it from here.
    pub fn connectable(&self) -> bool {
        self.connectable
    }

    /// What the connection provides, or would provide once connected.
    pub fn surfaces(&self) -> Surfaces {
        self.surfaces
    }
}

/// Which apps an agent may reach.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Selection {
    /// Every connection the owner has.
    All,
    /// Exactly these apps, connected or not, and no server added by URL.
    Apps(Vec<ConnectorId>),
}

impl Selection {
    fn allows(&self, key: &ConnectorKey) -> bool {
        match (self, key) {
            (Self::All, _) => true,
            (Self::Apps(apps), ConnectorKey::App(app)) => apps.contains(app),
            (Self::Apps(_), ConnectorKey::Server(_)) => false,
        }
    }

    /// The narrower of two selections.
    fn narrowed(&self, other: &Selection) -> Selection {
        match (self, other) {
            (Self::All, other) => other.clone(),
            (this, Self::All) => this.clone(),
            (Self::Apps(apps), Self::Apps(others)) => Self::Apps(
                apps.iter()
                    .filter(|app| others.contains(app))
                    .cloned()
                    .collect(),
            ),
        }
    }
}

/// Proof that a connection may be dialed for MCP tools: the user holds it,
/// it is enabled and authorized, and it is the connection the rules count.
#[derive(Clone)]
pub struct McpHandle {
    key: ConnectorKey,
    name: String,
    connection: Arc<dyn McpConnection>,
}

impl McpHandle {
    pub(crate) fn new(key: ConnectorKey, name: String, connection: Arc<dyn McpConnection>) -> Self {
        Self {
            key,
            name,
            connection,
        }
    }

    /// The app or server it connects to.
    pub fn key(&self) -> &ConnectorKey {
        &self.key
    }

    /// The display name its tools are listed under.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The source's connection, to dial or address.
    pub(crate) fn connection(&self) -> &Arc<dyn McpConnection> {
        &self.connection
    }
}

impl fmt::Debug for McpHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("McpHandle")
            .field("key", &self.key)
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

/// Proof that a connection may call its app's REST API: the same connection
/// the rules count for MCP, from a source that provides an API for the app.
#[derive(Clone)]
pub struct ApiHandle {
    user: MacroUserIdStr<'static>,
    app: ConnectorId,
    connection: Arc<dyn ApiConnection>,
}

impl ApiHandle {
    pub(crate) fn new(
        user: MacroUserIdStr<'static>,
        app: ConnectorId,
        connection: Arc<dyn ApiConnection>,
    ) -> Self {
        Self {
            user,
            app,
            connection,
        }
    }

    /// The user whose connection it is.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.user
    }

    /// The app whose API it calls.
    pub fn app(&self) -> &ConnectorId {
        &self.app
    }

    /// The source's connection, to call through.
    pub(crate) fn connection(&self) -> &Arc<dyn ApiConnection> {
        &self.connection
    }
}

impl fmt::Debug for ApiHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApiHandle")
            .field("app", &self.app)
            .finish_non_exhaustive()
    }
}

/// Proof that a session's scope allows a destination. Only
/// [`McpConnections::permit`] and [`McpConnections::permit_unconnected`]
/// build one.
///
/// From `permit`, the destination is connected. From `permit_unconnected`,
/// it is an app the user cannot use yet, which
/// [`McpConnectionsService::upstream`](crate::McpConnectionsService::upstream)
/// still addresses for them where the app's counted source can: listing its
/// tools then works, and calling one is the caller's to answer with how to
/// connect it.
#[derive(Clone, Debug)]
pub struct Permitted<'a> {
    user: &'a MacroUserIdStr<'static>,
    reach: Reach<'a>,
}

#[derive(Clone, Debug)]
enum Reach<'a> {
    /// A connection the rules count and allow.
    Connected(&'a McpHandle),
    /// An app in scope the user holds no usable connection to.
    Unconnected(ConnectorKey),
}

impl<'a> Permitted<'a> {
    /// The permitted app or server.
    pub fn key(&self) -> &ConnectorKey {
        match &self.reach {
            Reach::Connected(handle) => &handle.key,
            Reach::Unconnected(key) => key,
        }
    }

    /// Whether the user has a usable connection to it. When not, its
    /// upstream (if it has one) lists tools but must not be sent a call.
    pub fn is_connected(&self) -> bool {
        matches!(self.reach, Reach::Connected(_))
    }

    /// The user the destination is reached for.
    pub(crate) fn user(&self) -> &'a MacroUserIdStr<'static> {
        self.user
    }

    /// The permitted connection; `None` for a destination the user cannot
    /// use yet.
    pub(crate) fn handle(&self) -> Option<&'a McpHandle> {
        match &self.reach {
            Reach::Connected(handle) => Some(handle),
            Reach::Unconnected(_) => None,
        }
    }
}

/// Why [`McpConnections::permit`] refused a destination.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PermitRefused {
    /// The agent was not given this app.
    #[error("the agent was not given this app")]
    OutOfScope,
    /// The agent may reach it, but the user has no usable connection to it;
    /// the caller answers with how to connect.
    #[error("the app is not usable: {0:?}")]
    NotUsable(Status),
}

/// One app or server in a user's answer.
#[derive(Clone, Debug)]
pub(crate) struct Resolved {
    pub(crate) key: ConnectorKey,
    pub(crate) name: String,
    pub(crate) status: Status,
    pub(crate) surfaces: Surfaces,
    pub(crate) mcp: Option<McpHandle>,
}

/// Everything one user has, already decided by the rules, optionally narrowed
/// to what an agent was given.
#[derive(Clone, Debug)]
pub struct McpConnections {
    user: MacroUserIdStr<'static>,
    resolved: Vec<Resolved>,
    scope: Selection,
}

impl McpConnections {
    /// The resolver's answer. `resolved` holds at most one entry per key.
    pub(crate) fn new(user: MacroUserIdStr<'static>, resolved: Vec<Resolved>) -> Self {
        Self {
            user,
            resolved,
            scope: Selection::All,
        }
    }

    /// The user this answer is for.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.user
    }

    /// Where the user stands with an app or server. Scope does not change a
    /// status; it changes what may be reached.
    pub fn status(&self, key: &ConnectorKey) -> Status {
        self.find(key)
            .map_or(Status::NotConnected, |resolved| resolved.status)
    }

    /// The connections that may be dialed for MCP tools, within scope.
    pub fn handles(&self) -> impl Iterator<Item = &McpHandle> {
        self.resolved
            .iter()
            .filter(|resolved| self.scope.allows(&resolved.key))
            .filter_map(|resolved| resolved.mcp.as_ref())
    }

    /// What a session in this scope is told it can address: every app it was
    /// given, connected or not, so a call can ask to connect; or, given
    /// everything, every connection that may be dialed, once each. One
    /// connection can count for several apps (a native server at an address
    /// several overlaid apps share); it is advertised under the first of
    /// them, so its tools are not listed twice under two names.
    pub fn destinations(&self) -> Vec<ConnectorKey> {
        match &self.scope {
            Selection::All => {
                let mut advertised: Vec<&McpHandle> = Vec::new();
                for handle in self.handles() {
                    let shared = advertised
                        .iter()
                        .any(|held| Arc::ptr_eq(&held.connection, &handle.connection));
                    if !shared {
                        advertised.push(handle);
                    }
                }
                advertised
                    .into_iter()
                    .map(|handle| handle.key.clone())
                    .collect()
            }
            Selection::Apps(apps) => apps.iter().cloned().map(ConnectorKey::App).collect(),
        }
    }

    /// The same answer narrowed to what an agent was given.
    pub fn scoped(&self, selection: &Selection) -> Self {
        Self {
            user: self.user.clone(),
            resolved: self.resolved.clone(),
            scope: self.scope.narrowed(selection),
        }
    }

    /// Proof that `key` may be reached in this scope.
    ///
    /// An app outside the scope is refused outright. An app in scope that is
    /// not connected is refused with its status, so the caller can answer
    /// with how to connect it.
    pub fn permit(&self, key: &ConnectorKey) -> Result<Permitted<'_>, PermitRefused> {
        if !self.scope.allows(key) {
            return Err(PermitRefused::OutOfScope);
        }

        let Some(resolved) = self.find(key) else {
            return Err(PermitRefused::NotUsable(Status::NotConnected));
        };
        match &resolved.mcp {
            Some(handle) => Ok(Permitted {
                user: &self.user,
                reach: Reach::Connected(handle),
            }),
            None => Err(PermitRefused::NotUsable(resolved.status)),
        }
    }

    /// Proof that `key`, an app in scope the user cannot use yet (never
    /// connected, or turned off), may still be addressed for them, so a
    /// client can list its tools before they connect it.
    ///
    /// Whether it can be addressed is the app's counted source's to say:
    /// [`McpConnectionsService::upstream`](crate::McpConnectionsService::upstream)
    /// refuses one whose source needs the user's own connection to reach it.
    /// An app outside the scope is refused outright, a server added by URL
    /// is never addressable without its row, and an app the user can use is
    /// permitted as [`Self::permit`] permits it.
    pub fn permit_unconnected(&self, key: &ConnectorKey) -> Result<Permitted<'_>, PermitRefused> {
        match self.permit(key) {
            Err(PermitRefused::NotUsable(_)) if matches!(key, ConnectorKey::App(_)) => {
                Ok(Permitted {
                    user: &self.user,
                    reach: Reach::Unconnected(key.clone()),
                })
            }
            answer => answer,
        }
    }

    /// Every app and server the user holds through a counted source, in
    /// scope or not.
    pub(crate) fn resolved(&self) -> &[Resolved] {
        &self.resolved
    }

    fn find(&self, key: &ConnectorKey) -> Option<&Resolved> {
        self.resolved.iter().find(|resolved| resolved.key == *key)
    }
}

/// Where the egress proxy sends a sandbox's MCP request, and what it stamps
/// on it. The bearer is a secret: it never reaches the sandbox, and `Debug`
/// does not print it.
#[derive(Clone)]
pub struct Upstream {
    url: Url,
    bearer: Option<String>,
    headers: http::HeaderMap,
}

impl Upstream {
    pub(crate) fn new(url: Url, bearer: Option<String>, headers: http::HeaderMap) -> Self {
        Self {
            url,
            bearer,
            headers,
        }
    }

    /// The upstream MCP endpoint.
    pub fn url(&self) -> &Url {
        &self.url
    }

    /// The bearer token for `Authorization`, or `None` for a server that
    /// takes anonymous requests.
    pub fn bearer(&self) -> Option<&str> {
        self.bearer.as_deref()
    }

    /// Headers that scope the call to the user and app.
    pub fn headers(&self) -> &http::HeaderMap {
        &self.headers
    }
}

impl fmt::Debug for Upstream {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Upstream")
            .field("url", &self.url)
            .field("bearer", &self.bearer.as_ref().map(|_| "<redacted>"))
            .finish_non_exhaustive()
    }
}

/// A request to a connected app's own REST API.
#[derive(Clone, Debug)]
pub struct ApiRequest {
    /// The HTTP method.
    pub method: http::Method,
    /// The absolute URL, e.g. `https://api.notion.com/v1/search`.
    pub url: String,
    /// Upstream headers, never `Authorization`.
    pub headers: http::HeaderMap,
    /// A JSON body, if any.
    pub body: Option<serde_json::Value>,
}

/// A connected app's answer, whatever its status. Never log the body: some
/// apps return secrets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiResponse {
    /// The HTTP status.
    pub status: http::StatusCode,
    /// The app's response headers.
    pub headers: http::HeaderMap,
    /// The response body.
    pub body: String,
}

impl ApiResponse {
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

/// Why a connectors service call failed.
#[derive(Debug, thiserror::Error)]
pub enum ConnectorsError {
    /// The app is not in the catalog.
    #[error("{0} is not in the catalog")]
    UnknownApp(ConnectorId),
    /// The user holds no connection to this app or server.
    #[error("no connection to {0}")]
    NotFound(ConnectorKey),
    /// The connection's grant stopped working while it was being used.
    #[error("the connection to {0} must be authorized again")]
    NeedsReauth(ConnectorKey),
    /// An agent tried to add a server that is not public `https`.
    #[error("`{0}` is not a public https URL")]
    NonPublicServer(ServerUrl),
    /// The display name is empty.
    #[error("the name is empty")]
    EmptyName,
    /// A source's store or vendor failed.
    #[error("connectors internal error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for ConnectorsError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

/// The result of a connectors service call.
pub type Result<T, E = ConnectorsError> = std::result::Result<T, E>;

/// The MCP tools loaded for a user: one toolset over the servers their
/// usable connections dialed, built by
/// [`McpConnectionsService::toolset`](crate::McpConnectionsService::toolset).
pub struct UserMcpTools(RemoteMcpToolSet);

impl UserMcpTools {
    /// The tools of servers already dialed.
    pub(crate) fn new(tools: RemoteMcpToolSet) -> Self {
        Self(tools)
    }

    /// Returns `true` when no tools were discovered.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The full catalog of MCP tools for on-demand loading via tool search.
    pub fn catalog(&self) -> Vec<SearchableTool> {
        self.0.searchable_catalog()
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for UserMcpTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        self.0
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        ToolSet::<Context>::request_schemas(&self.0)
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        ToolSet::<Context>::searchable_toolset_names(&self.0)
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.0, tool_name)
    }
}
