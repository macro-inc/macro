//! In-memory sources: one shared table of rows that every fake source reads
//! its own kind from, as the real sources share their stores.

use crate::domain::catalog::Overlays;
use crate::domain::discovery::OrgSetup;
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

/// The rows every fake source reads, and the API calls they received.
#[derive(Default)]
pub(crate) struct FakeStore {
    pub(crate) rows: Vec<FakeRow>,
    pub(crate) api_calls: Vec<ApiCall>,
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
    /// The admin setup each app it serves needs, where one does.
    pub(crate) org_setups: HashMap<ConnectorId, OrgSetup>,
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
                name: row.name.clone(),
                tools: row.tools.clone(),
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

    async fn org_setups(
        &self,
        apps: &[ConnectorId],
    ) -> Result<HashMap<ConnectorId, OrgSetup>, rootcause::Report> {
        Ok(apps
            .iter()
            .filter_map(|app| Some((app.clone(), self.org_setups.get(app)?.clone())))
            .collect())
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
            name: app.to_string(),
            tools: Vec::new(),
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
    name: String,
    tools: Vec<String>,
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
        let (server_side, client_side) = tokio::io::duplex(SESSION_BUFFER);
        let server = FakeServer {
            name: self.name.clone(),
            tools: self.tools.clone(),
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

/// Lists its tools; each answers `<server>:<tool>`.
#[derive(Clone)]
struct FakeServer {
    name: String,
    tools: Vec<String>,
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
        let answer = format!("{}:{}", self.name, request.name);

        Ok(CallToolResult::success(vec![ContentBlock::text(answer)]).into())
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
