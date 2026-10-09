//! Dialing the HTTP MCP servers a session was handed over ACP.
//!
//! Sessions are pooled by server name, URL, and credential. A later turn, a
//! replaced agent task, and the telemetry catalog all reuse the open session
//! and the tool list it already returned, instead of handshaking again. The
//! pool drops a session when its bearer token is released at teardown, or
//! when the session itself has closed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use agent_client_protocol::schema::v1::McpServerHttp;
use futures::FutureExt as _;
use futures::future::BoxFuture;
use http::header::{AUTHORIZATION, HeaderName, HeaderValue};
use mcp_toolset::{ListedServer, McpServer, RemoteMcpToolSet, client_info};
use rmcp::ServiceExt as _;
use rmcp::model::Tool;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClient, StreamableHttpClientTransportConfig,
};
use tracing::Instrument as _;

use crate::domain::mcp::McpToolConnector;

#[cfg(test)]
mod test;

/// Where one advertised header goes on the rmcp transport.
#[derive(Debug, PartialEq, Eq)]
enum HeaderPlacement {
    /// `Authorization: Bearer <token>`: rmcp takes the bare token and adds the
    /// scheme itself, so the scheme must come off here or the proxy sees
    /// `Bearer Bearer <token>` and knows no such session.
    BearerToken(String),
    /// Anything else, sent verbatim.
    Custom(HeaderName, HeaderValue),
}

/// Decide how an ACP `HttpHeader` reaches the wire. `None` when the name or
/// value is not a valid header.
fn place_header(name: &str, value: &str) -> Option<HeaderPlacement> {
    let header_name = HeaderName::from_bytes(name.as_bytes()).ok()?;
    if header_name == AUTHORIZATION {
        let mut parts = value.splitn(2, ' ');
        if let (Some(scheme), Some(token)) = (parts.next(), parts.next())
            && scheme.eq_ignore_ascii_case("bearer")
        {
            return Some(HeaderPlacement::BearerToken(token.trim().to_owned()));
        }
    }
    let header_value = HeaderValue::from_str(value).ok()?;
    Some(HeaderPlacement::Custom(header_name, header_value))
}

/// [`McpToolConnector`] over rmcp's streamable-HTTP client.
///
/// Each entry is dialed exactly as handed over: its URL is the egress proxy
/// and its `Authorization` header is the session token, so this process holds
/// no upstream credential any more than a sandbox does. What carries the
/// request is the `Client` - in production
/// [`EgressMcpClient`](super::egress_mcp::EgressMcpClient), which hands it
/// to the proxy's service without a socket.
///
/// Open sessions live in [`ServerPool`], shared by every clone. Replacing the
/// agent task drops the toolset it held, not the session.
#[derive(Clone)]
pub struct AcpMcpConnector<Client> {
    client: Client,
    pool: Arc<ServerPool>,
    source: Option<Arc<dyn crate::domain::mcp::SessionMcpSource>>,
}

impl<Client> AcpMcpConnector<Client>
where
    Client: StreamableHttpClient + Send + Sync,
{
    /// A connector sharing one client, and one session pool, across every
    /// server it dials.
    pub fn new(client: Client) -> Self {
        let pool = Arc::new(ServerPool::default());
        let weak = Arc::downgrade(&pool);
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                loop {
                    tokio::time::sleep(POOL_REAP_INTERVAL).await;
                    let Some(pool) = weak.upgrade() else {
                        break;
                    };
                    pool.lock().entries.retain(|_, entry| !entry.expired());
                }
            });
        }
        Self {
            client,
            pool,
            source: None,
        }
    }

    /// Refresh the session's permitted app list before each native turn.
    pub fn with_source(mut self, source: Arc<dyn crate::domain::mcp::SessionMcpSource>) -> Self {
        self.source = Some(source);
        self
    }

    /// The pooled session for `server`, dialing it only when this connector
    /// does not already have a live one.
    ///
    /// A hit is the tool list from the last handshake, so the caller can
    /// start the model without another round trip. Concurrent callers for
    /// the same server share one dial.
    async fn cached_server(&self, server: McpServerHttp) -> Lookup {
        let (key, config) = prepare(&server);
        let client = self.client.clone();
        let pool = Arc::clone(&self.pool);
        let wait = {
            let mut state = pool.lock();
            state.entries.retain(|_, entry| !entry.expired());
            if let Some(listed) = take_ready(&mut state, &key) {
                return Lookup::Pooled(listed);
            }
            if let Some(Entry::Pending { fut, .. }) = state.entries.get(&key) {
                fut.clone()
            } else {
                if state.entries.len() >= MAX_POOLED_SERVERS {
                    let oldest = state
                        .entries
                        .iter()
                        .filter_map(|(key, entry)| match entry {
                            Entry::Ready { touched, .. } => Some((key.clone(), *touched)),
                            Entry::Pending { .. } => None,
                        })
                        .min_by_key(|(_, touched)| *touched)
                        .map(|(key, _)| key);
                    let Some(oldest) = oldest else {
                        return Lookup::Failed;
                    };
                    state.entries.remove(&oldest);
                }
                let generation = state.generation;
                state.generation = state.generation.wrapping_add(1);
                let name = key.name.clone();
                let key_for_dial = key.clone();
                let pool_for_dial = Arc::clone(&pool);
                let fut = async move {
                    let outcome = tokio::time::timeout(HANDSHAKE_TIMEOUT, async {
                        let _permit = pool_for_dial.handshakes.acquire().await.ok()?;
                        open_server(&client, &name, config).await
                    })
                    .await
                    .ok()
                    .flatten();
                    pool_for_dial.finish(&key_for_dial, generation, outcome.clone());
                    outcome
                }
                .boxed()
                .shared();
                state.entries.insert(
                    key,
                    Entry::Pending {
                        generation,
                        started: Instant::now(),
                        fut: fut.clone(),
                    },
                );
                fut
            }
        };
        match wait.await {
            Some(cached) => Lookup::Dialed(listed_from(&cached)),
            None => Lookup::Failed,
        }
    }
}

/// How one server's session was obtained, so a connect can say how much of
/// its time went to handshakes rather than the pool.
enum Lookup {
    Pooled(ListedServer),
    Dialed(ListedServer),
    Failed,
}

impl<Client> McpToolConnector for AcpMcpConnector<Client>
where
    Client: StreamableHttpClient + Send + Sync,
{
    async fn refresh(
        &self,
        session: agent_session::domain::model::AgentSessionId,
        advertised: Vec<agent_client_protocol::schema::v1::McpServer>,
    ) -> anyhow::Result<Option<Vec<agent_client_protocol::schema::v1::McpServer>>> {
        match &self.source {
            Some(source) => source.servers(session, advertised).await.map(Some),
            None => Ok(None),
        }
    }
    #[tracing::instrument(
        skip_all,
        fields(
            servers = servers.len(),
            pooled = tracing::field::Empty,
            dialed = tracing::field::Empty,
            failed = tracing::field::Empty,
            elapsed_ms = tracing::field::Empty,
        )
    )]
    async fn connect(&self, servers: Vec<McpServerHttp>) -> Option<RemoteMcpToolSet> {
        if servers.is_empty() {
            return None;
        }
        let started = std::time::Instant::now();
        let mut pooled = 0usize;
        let mut dialed = 0usize;
        let mut failed = 0usize;
        let mut listed = Vec::with_capacity(servers.len());
        for lookup in
            futures::future::join_all(servers.into_iter().map(|server| self.cached_server(server)))
                .await
        {
            match lookup {
                Lookup::Pooled(server) => {
                    pooled += 1;
                    listed.push(server);
                }
                Lookup::Dialed(server) => {
                    dialed += 1;
                    listed.push(server);
                }
                Lookup::Failed => failed += 1,
            }
        }
        let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        let span = tracing::Span::current();
        span.record("pooled", pooled);
        span.record("dialed", dialed);
        span.record("failed", failed);
        span.record("elapsed_ms", elapsed_ms);
        tracing::info!(pooled, dialed, failed, elapsed_ms, "resolved MCP sessions");
        if listed.is_empty() {
            return None;
        }
        let tools = RemoteMcpToolSet::from_listed(listed, None);
        if tools.is_empty() { None } else { Some(tools) }
    }

    fn release(&self, token: &str) {
        self.pool.release_bearer(token);
    }
}

/// One dial shared by every caller waiting on it.
type DialFut = futures::future::Shared<BoxFuture<'static, Option<Arc<CachedServer>>>>;

/// An open session and the tools it listed, reused until it closes.
struct CachedServer {
    name: String,
    client: Arc<McpServer>,
    tools: Vec<Tool>,
}

/// What distinguishes one pooled session from another.
///
/// The bearer is the session token. Two sessions never share a client, and
/// releasing the token drops every server that presented it.
#[derive(Clone, PartialEq, Eq, Hash)]
struct ServerKey {
    name: String,
    url: String,
    bearer: Option<String>,
    headers: Vec<(String, String)>,
}

const MAX_POOLED_SERVERS: usize = 256;
const MAX_CONCURRENT_HANDSHAKES: usize = 16;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const POOL_REAP_INTERVAL: Duration = Duration::from_secs(60);
const POOL_IDLE_TTL: Duration = Duration::from_secs(600);

enum Entry {
    Ready {
        cached: Arc<CachedServer>,
        touched: Instant,
    },
    Pending {
        generation: u64,
        started: Instant,
        fut: DialFut,
    },
}

impl Entry {
    fn expired(&self) -> bool {
        match self {
            Self::Ready { cached, touched } => {
                touched.elapsed() >= POOL_IDLE_TTL || session_closed(cached)
            }
            Self::Pending { started, .. } => started.elapsed() >= HANDSHAKE_TIMEOUT,
        }
    }
}

struct PoolState {
    generation: u64,
    entries: HashMap<ServerKey, Entry>,
}

/// Live MCP sessions, keyed so a second `connect` with the same server does
/// not handshake.
struct ServerPool {
    handshakes: tokio::sync::Semaphore,
    state: Mutex<PoolState>,
}

impl Default for ServerPool {
    fn default() -> Self {
        Self {
            handshakes: tokio::sync::Semaphore::new(MAX_CONCURRENT_HANDSHAKES),
            state: Mutex::new(PoolState {
                generation: 0,
                entries: HashMap::new(),
            }),
        }
    }
}

impl ServerPool {
    fn lock(&self) -> std::sync::MutexGuard<'_, PoolState> {
        self.state.lock().expect("mcp client pool lock")
    }

    fn finish(&self, key: &ServerKey, generation: u64, outcome: Option<Arc<CachedServer>>) {
        let mut state = self.lock();
        let still_ours = matches!(
            state.entries.get(key),
            Some(Entry::Pending {
                generation: current,
                ..
            }) if *current == generation
        );
        if !still_ours {
            return;
        }
        match outcome {
            Some(cached) => {
                state.entries.insert(
                    key.clone(),
                    Entry::Ready {
                        cached,
                        touched: Instant::now(),
                    },
                );
            }
            None => {
                state.entries.remove(key);
            }
        }
    }

    fn release_bearer(&self, token: &str) {
        self.lock()
            .entries
            .retain(|key, _| key.bearer.as_deref() != Some(token));
    }
}

/// Build the pool key and the transport config from the same header placement,
/// so a cache hit is a session that would have been dialed identically.
fn prepare(server: &McpServerHttp) -> (ServerKey, StreamableHttpClientTransportConfig) {
    let mut config = StreamableHttpClientTransportConfig::with_uri(server.url.clone());
    let mut bearer = None;
    let mut custom = HashMap::new();
    for header in &server.headers {
        match place_header(&header.name, &header.value) {
            Some(HeaderPlacement::BearerToken(token)) => {
                bearer = Some(token.clone());
                config = config.auth_header(token);
            }
            Some(HeaderPlacement::Custom(name, value)) => {
                custom.insert(name, value);
            }
            None => {
                tracing::warn!(server = %server.name, header = %header.name, "dropping an invalid header");
            }
        }
    }
    let mut headers: Vec<(String, String)> = custom
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_owned(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    headers.sort();
    config.custom_headers = custom;
    (
        ServerKey {
            name: server.name.clone(),
            url: server.url.clone(),
            bearer,
            headers,
        },
        config,
    )
}

fn session_closed(cached: &CachedServer) -> bool {
    cached.client.is_closed() || cached.client.is_transport_closed()
}

fn listed_from(cached: &CachedServer) -> ListedServer {
    ListedServer {
        name: cached.name.clone(),
        client: Arc::clone(&cached.client),
        tools: cached.tools.clone(),
    }
}

/// A ready entry whose session is still up, or `None` when it must be dialed.
fn take_ready(state: &mut PoolState, key: &ServerKey) -> Option<ListedServer> {
    let closed = matches!(
        state.entries.get(key),
        Some(Entry::Ready { cached, .. }) if session_closed(cached)
    );
    if closed {
        tracing::debug!(server = %key.name, "pooled MCP client is closed; dialing again");
        state.entries.remove(key);
        return None;
    }
    let Some(Entry::Ready { cached, touched }) = state.entries.get_mut(key) else {
        return None;
    };
    *touched = Instant::now();
    Some(listed_from(cached))
}

#[tracing::instrument(skip_all, fields(server = %name))]
async fn open_server<Client>(
    client: &Client,
    name: &str,
    config: StreamableHttpClientTransportConfig,
) -> Option<Arc<CachedServer>>
where
    Client: StreamableHttpClient + Send + Sync,
{
    let transport = StreamableHttpClientTransport::with_client(client.clone(), config);
    let running = match client_info()
        .serve(transport)
        .instrument(tracing::info_span!("agent.mcp.initialize", server = %name))
        .await
    {
        Ok(running) => running,
        Err(error) => {
            // One server that will not answer must not cost the session
            // the others, nor the session itself.
            tracing::warn!(server = %name, error = ?error, "failed to connect to an MCP server; skipping it");
            return None;
        }
    };
    match running
        .list_all_tools()
        .instrument(tracing::info_span!("agent.mcp.list_tools", server = %name))
        .await
    {
        Ok(tools) => Some(Arc::new(CachedServer {
            name: name.to_owned(),
            client: Arc::new(running),
            tools,
        })),
        Err(error) => {
            tracing::warn!(server = %name, error = ?error, "failed to list tools; skipping the server");
            let _ = running.cancel().await;
            None
        }
    }
}
