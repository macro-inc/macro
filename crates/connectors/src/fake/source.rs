//! In-memory sources: one shared table of rows that every fake source reads
//! its own kind from, as the real sources share their stores.

use crate::domain::catalog::Overlays;
use crate::domain::models::{
    AddedBy, ApiRequest, ApiResponse, ConnectStep, ConnectorId, ConnectorKey, ServerUrl, Surfaces,
    Upstream,
};
use crate::domain::ports::{
    ApiConnection, GrantState, McpConnection, ServerDirectory, Source, SourceConnection,
    SourceKind, SourceRefusal,
};
use crate::domain::resolve;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::McpServer;
use rmcp::ServiceExt as _;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ErrorData,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

/// The app's GitHub link page, as the fake account link answers a connect.
pub(crate) const FAKE_GITHUB_LINK_PAGE: &str = "https://app.fake.test/app/connect/github";

/// Bytes buffered each way between a fake MCP server and its client.
const SESSION_BUFFER: usize = 64 * 1024;

/// One stored connection.
#[derive(Clone, Debug)]
pub(crate) struct FakeRow {
    pub(crate) user: MacroUserIdStr<'static>,
    pub(crate) source: SourceKind,
    pub(crate) key: ConnectorKey,
    pub(crate) name: String,
    pub(crate) enabled: bool,
    pub(crate) grant: GrantState,
    /// Whether the row gives API access, as its source would for its app.
    pub(crate) api: bool,
    /// The tools its MCP server lists.
    pub(crate) tools: Vec<String>,
    /// What every API call through it answers once `in_turn` is empty.
    pub(crate) response: (http::StatusCode, String),
    /// Answers given one per API call, in order, before `response`.
    pub(crate) in_turn: Arc<Mutex<VecDeque<ApiResponse>>>,
    /// Scripted answers per tool, one per call in order, before the default
    /// `<name>:<tool>` text.
    pub(crate) tool_answers: Arc<Mutex<HashMap<String, VecDeque<CallToolResult>>>>,
    /// What dialing its MCP server does.
    pub(crate) dial: FakeDial,
    /// A test's own MCP server, served in place of the scripted one.
    pub(crate) served_by: Option<FakeServe>,
}

/// Serves a test's own MCP server on one end of an in-process session.
#[derive(Clone)]
pub(crate) struct FakeServe(
    pub(crate)  Arc<
        dyn Fn(tokio::io::DuplexStream) -> futures::future::BoxFuture<'static, ()> + Send + Sync,
    >,
);

impl std::fmt::Debug for FakeServe {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("FakeServe")
    }
}

/// What dialing a fake connection's MCP server does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum FakeDial {
    /// Connects.
    #[default]
    Connects,
    /// Fails as a transport outage would.
    Fails,
    /// Refuses, as a server does when it revoked the refresh token the row
    /// still holds.
    Revoked,
    /// Never finishes, as a server that accepts the connection and never
    /// answers the handshake.
    Hangs,
}

impl FakeRow {
    /// An enabled, authorized row with no tools and an API that answers
    /// `200 {}` where `api` is set.
    pub(crate) fn new(
        user: MacroUserIdStr<'static>,
        source: SourceKind,
        key: ConnectorKey,
        api: bool,
    ) -> Self {
        Self {
            name: key.to_string(),
            user,
            source,
            key,
            enabled: true,
            grant: GrantState::Working,
            api,
            tools: Vec::new(),
            response: (http::StatusCode::OK, "{}".to_owned()),
            in_turn: Arc::default(),
            tool_answers: Arc::default(),
            dial: FakeDial::Connects,
            served_by: None,
        }
    }
}

/// One API call a fake connection received.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiCall {
    /// The app or server it went to.
    pub key: ConnectorKey,
    /// The request's method.
    pub method: http::Method,
    /// The request's URL.
    pub url: String,
    /// The request's headers.
    pub headers: http::HeaderMap,
    /// The request's JSON body.
    pub body: Option<serde_json::Value>,
}

/// One MCP tool call a fake connection's server received.
#[derive(Clone, Debug, PartialEq)]
pub struct McpCall {
    /// The app or server it went to.
    pub key: ConnectorKey,
    /// The tool, by the name the server lists.
    pub tool: String,
    /// The call's arguments.
    pub arguments: serde_json::Map<String, serde_json::Value>,
}

/// The rows every fake source reads, and the calls they received.
#[derive(Default)]
pub(crate) struct FakeStore {
    pub(crate) rows: Vec<FakeRow>,
    pub(crate) api_calls: Vec<ApiCall>,
    pub(crate) mcp_calls: Vec<McpCall>,
    /// Users whose connections no source can list, as when a store is down.
    pub(crate) unreachable: Vec<MacroUserIdStr<'static>>,
}

/// The shared table.
pub(crate) type SharedStore = Arc<Mutex<FakeStore>>;

pub(crate) fn lock(store: &SharedStore) -> MutexGuard<'_, FakeStore> {
    store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A source of one kind over the shared table.
pub(crate) struct FakeSource {
    pub(crate) kind: SourceKind,
    pub(crate) store: SharedStore,
    /// The apps it serves and how.
    pub(crate) supported: HashMap<ConnectorId, Surfaces>,
    /// The overlay table, which decides what a native row is to.
    pub(crate) overlays: Overlays,
}

impl FakeSource {
    fn connection(&self, row: &FakeRow) -> SourceConnection {
        let api: Option<Arc<dyn ApiConnection>> = row.api.then(|| {
            Arc::new(FakeApi {
                key: row.key.clone(),
                response: row.response.clone(),
                in_turn: row.in_turn.clone(),
                store: self.store.clone(),
            }) as Arc<dyn ApiConnection>
        });

        SourceConnection {
            source: row.source,
            key: row.key.clone(),
            source_id: row.key.to_string(),
            name: row.name.clone(),
            enabled: row.enabled,
            grant: row.grant,
            mcp: Some(Arc::new(FakeMcp {
                key: row.key.clone(),
                name: row.name.clone(),
                tools: row.tools.clone(),
                tool_answers: row.tool_answers.clone(),
                dial: row.dial,
                served_by: row.served_by.clone(),
                store: self.store.clone(),
                scope: match (&row.source, &row.key) {
                    (SourceKind::Pipedream, ConnectorKey::App(app)) => {
                        Some((row.user.clone(), app.clone()))
                    }
                    _ => None,
                },
            })),
            api,
        }
    }

    fn is_mine(&self, row: &FakeRow, user: &MacroUserIdStr<'static>) -> bool {
        row.source == self.kind && row.user == *user
    }

    fn not_found(key: &ConnectorKey) -> rootcause::Report {
        rootcause::Report::new(SourceRefusal::NotFound(key.clone())).into_dynamic()
    }

    /// Change the user's row at `key` here.
    fn update(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        change: impl FnOnce(&mut FakeRow),
    ) -> Result<(), rootcause::Report> {
        let mut store = lock(&self.store);
        let row = store
            .rows
            .iter_mut()
            .find(|row| self.is_mine(row, user) && row.key == *key)
            .ok_or_else(|| Self::not_found(key))?;
        change(row);

        Ok(())
    }

    fn is_hosted(kind: SourceKind) -> bool {
        matches!(kind, SourceKind::Pipedream | SourceKind::Connect)
    }
}

#[async_trait::async_trait]
impl Source for FakeSource {
    fn kind(&self) -> SourceKind {
        self.kind
    }

    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, rootcause::Report> {
        let store = lock(&self.store);
        if store.unreachable.contains(user) {
            return Err(rootcause::report!("the store is down"));
        }

        Ok(store
            .rows
            .iter()
            .filter(|row| self.is_mine(row, user))
            .map(|row| self.connection(row))
            .collect())
    }

    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, rootcause::Report> {
        Ok(self.supported.get(app).copied())
    }

    async fn holders(
        &self,
        app: &ConnectorId,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        let key = ConnectorKey::App(app.clone());
        let store = lock(&self.store);

        Ok(store
            .rows
            .iter()
            .filter(|row| row.source == self.kind && row.enabled)
            .filter(|row| resolve::identify(&self.connection(row), &self.overlays).contains(&key))
            .map(|row| row.user.clone())
            .collect())
    }

    /// Pipedream addresses a user by id and app alone, as the real one
    /// does; no other source can reach an app without the user's
    /// connection.
    async fn address_unconnected(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<Upstream>, rootcause::Report> {
        if self.kind != SourceKind::Pipedream {
            return Ok(None);
        }
        let mcp = FakeMcp {
            key: ConnectorKey::App(app.clone()),
            name: app.to_string(),
            tools: Vec::new(),
            tool_answers: Arc::default(),
            dial: FakeDial::Connects,
            served_by: None,
            store: self.store.clone(),
            scope: Some((user.clone(), app.clone())),
        };

        mcp.upstream().await.map(Some)
    }

    async fn start_connect(
        &self,
        _user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, rootcause::Report> {
        // The account link opens the app's link page, as the real source
        // does; every other source a consent page of its own.
        if self.kind == SourceKind::GithubLink {
            let page = url::Url::parse(FAKE_GITHUB_LINK_PAGE)
                .map_err(|error| rootcause::report!("{error}"))?;
            return Ok(ConnectStep::OpenUrl(page));
        }
        let mut url = url::Url::parse("https://connect.fake.test/")
            .map_err(|error| rootcause::report!("{error}"))?;
        url.query_pairs_mut()
            .append_pair("source", &format!("{:?}", self.kind))
            .append_pair("key", &key.to_string());

        Ok(ConnectStep::OpenUrl(url))
    }

    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, rootcause::Report> {
        let key = ConnectorKey::App(app.clone());
        let Some(surfaces) = self.supported.get(app) else {
            return Err(rootcause::Report::new(SourceRefusal::Unsupported(key)).into_dynamic());
        };

        // Pipedream and Connect share one table keyed by user and app, so
        // connecting through one replaces the other's row.
        let mut store = lock(&self.store);
        store.rows.retain(|row| {
            let same_slot = row.user == *user && row.key == key;
            let replaced = if Self::is_hosted(self.kind) {
                Self::is_hosted(row.source)
            } else {
                row.source == self.kind
            };
            !(same_slot && replaced)
        });
        let row = FakeRow::new(user.clone(), self.kind, key, surfaces.api());
        store.rows.push(row.clone());

        Ok(self.connection(&row))
    }

    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), rootcause::Report> {
        self.update(user, key, |row| row.enabled = enabled)
    }

    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), rootcause::Report> {
        self.update(user, key, |row| row.name = name.to_owned())
    }

    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), rootcause::Report> {
        let mut store = lock(&self.store);
        let before = store.rows.len();
        store
            .rows
            .retain(|row| !(self.is_mine(row, user) && row.key == *key));
        if store.rows.len() == before {
            return Err(Self::not_found(key));
        }

        Ok(())
    }
}

#[async_trait::async_trait]
impl ServerDirectory for FakeSource {
    async fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: &ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> Result<SourceConnection, rootcause::Report> {
        if added_by == AddedBy::Agent && !url.as_str().starts_with("https://") {
            return Err(
                rootcause::Report::new(SourceRefusal::NonPublic(url.clone())).into_dynamic(),
            );
        }

        let key = ConnectorKey::Server(url.clone());
        let mut store = lock(&self.store);
        if let Some(row) = store
            .rows
            .iter()
            .find(|row| self.is_mine(row, user) && row.key == key)
        {
            return Ok(self.connection(row));
        }

        let mut row = FakeRow::new(user.clone(), SourceKind::Native, key, false);
        row.name = name.to_owned();
        row.grant = GrantState::Missing;
        store.rows.push(row.clone());

        Ok(self.connection(&row))
    }
}

/// An MCP connection that dials an in-process server listing its tools.
struct FakeMcp {
    key: ConnectorKey,
    name: String,
    tools: Vec<String>,
    tool_answers: Arc<Mutex<HashMap<String, VecDeque<CallToolResult>>>>,
    dial: FakeDial,
    served_by: Option<FakeServe>,
    store: SharedStore,
    /// For a Pipedream row, the user and app its upstream is scoped to,
    /// stamped as Pipedream's own scoping headers.
    scope: Option<(MacroUserIdStr<'static>, ConnectorId)>,
}

/// Pipedream's header naming whose account a call spends.
const PIPEDREAM_USER_HEADER: &str = "x-pd-external-user-id";
/// Pipedream's header naming the app a call is to.
const PIPEDREAM_APP_HEADER: &str = "x-pd-app-slug";

#[async_trait::async_trait]
impl McpConnection for FakeMcp {
    async fn dial(&self) -> Result<McpServer, rootcause::Report> {
        match self.dial {
            FakeDial::Connects => {}
            FakeDial::Fails => return Err(rootcause::report!("the fake server is unreachable")),
            FakeDial::Revoked => return Err(SourceRefusal::NeedsReauth(self.key.clone()).into()),
            FakeDial::Hangs => std::future::pending().await,
        }
        let (server_side, client_side) = tokio::io::duplex(SESSION_BUFFER);
        if let Some(FakeServe(serve)) = &self.served_by {
            tokio::spawn(serve(server_side));
            return mcp_toolset::client_info()
                .serve(client_side)
                .await
                .map_err(|error| rootcause::report!("fake MCP handshake failed: {error}"));
        }
        let server = FakeServer {
            key: self.key.clone(),
            name: self.name.clone(),
            tools: self.tools.clone(),
            tool_answers: self.tool_answers.clone(),
            store: self.store.clone(),
        };
        tokio::spawn(async move {
            if let Ok(running) = server.serve(server_side).await {
                let _ = running.waiting().await;
            }
        });

        mcp_toolset::client_info()
            .serve(client_side)
            .await
            .map_err(|error| rootcause::report!("fake MCP handshake failed: {error}"))
    }

    async fn upstream(&self) -> Result<Upstream, rootcause::Report> {
        let mut url = url::Url::parse("https://upstream.fake.test/mcp")
            .map_err(|error| rootcause::report!("{error}"))?;
        url.query_pairs_mut().append_pair("server", &self.name);

        let mut headers = http::HeaderMap::new();
        if let Some((user, app)) = &self.scope {
            let value = |text: &str| {
                http::HeaderValue::from_str(text).map_err(|error| rootcause::report!("{error}"))
            };
            headers.insert(PIPEDREAM_USER_HEADER, value(user.as_ref())?);
            headers.insert(PIPEDREAM_APP_HEADER, value(app.as_str())?);
        }

        Ok(Upstream::new(url, Some("fake-token".to_owned()), headers))
    }
}

/// Lists its tools; each answers its scripted results in turn, then
/// `<server>:<tool>`. Records every call.
#[derive(Clone)]
struct FakeServer {
    key: ConnectorKey,
    name: String,
    tools: Vec<String>,
    tool_answers: Arc<Mutex<HashMap<String, VecDeque<CallToolResult>>>>,
    store: SharedStore,
}

impl rmcp::ServerHandler for FakeServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(
            self.tools
                .iter()
                .map(|tool| {
                    Tool::new(
                        tool.clone(),
                        format!("{tool} on {}", self.name),
                        Arc::new(serde_json::Map::new()),
                    )
                })
                .collect(),
        ))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let tool = request.name.to_string();
        if !self.tools.contains(&tool) {
            return Err(ErrorData::invalid_params(
                format!("unknown tool {tool}"),
                None,
            ));
        }
        lock(&self.store).mcp_calls.push(McpCall {
            key: self.key.clone(),
            tool: tool.clone(),
            arguments: request.arguments.unwrap_or_default(),
        });
        let scripted = self
            .tool_answers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get_mut(&tool)
            .and_then(VecDeque::pop_front);
        let answer = scripted.unwrap_or_else(|| {
            CallToolResult::success(vec![ContentBlock::text(format!("{}:{tool}", self.name))])
        });

        Ok(answer.into())
    }
}

/// An API connection that records each call and answers with the next
/// queued response, or else the same way every time.
struct FakeApi {
    key: ConnectorKey,
    response: (http::StatusCode, String),
    in_turn: Arc<Mutex<VecDeque<ApiResponse>>>,
    store: SharedStore,
}

#[async_trait::async_trait]
impl ApiConnection for FakeApi {
    async fn call(&self, request: ApiRequest) -> Result<ApiResponse, rootcause::Report> {
        lock(&self.store).api_calls.push(ApiCall {
            key: self.key.clone(),
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: request.body,
        });

        let queued = self
            .in_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front();

        Ok(queued.unwrap_or_else(|| ApiResponse {
            status: self.response.0,
            headers: http::HeaderMap::new(),
            body: self.response.1.clone(),
        }))
    }
}
