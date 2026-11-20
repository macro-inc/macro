//! Preserve MCP state within an account without sharing it between accounts.
use crate::domain::{
    error::EgressError,
    model::{AgentSessionId, UpstreamCall},
    ports::ActorMcpTransport,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::outbound::guarded_http::{self, AddressPolicy};
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransportConfig, StreamableHttpError,
};
use rmcp::{ServiceExt, model::ClientConfig, transport::StreamableHttpClientTransport};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex},
};
use tokio::sync::OnceCell;
use tracing::Instrument as _;

mod traced_client;
use traced_client::TracedClient;
#[cfg(test)]
mod test;

type Client = rmcp::service::RunningService<rmcp::RoleClient, ClientConfig>;
type Connection = Arc<OnceCell<Arc<Client>>>;

#[derive(Clone, Hash, PartialEq, Eq)]
struct AccountSession {
    session: AgentSessionId,
    actor: MacroUserIdStr<'static>,
    endpoint: String,
    credential: [u8; 32],
}

/// A bounded pool isolated by session, selected user, endpoint, and credential.
pub struct HttpActorMcpTransport {
    policy: AddressPolicy,
    client: TracedClient,
    sessions: Mutex<lru::LruCache<AccountSession, Connection>>,
}

impl HttpActorMcpTransport {
    /// Reuse an HTTP client with bounded requests, no credential-bearing
    /// redirects, and only the addresses `policy` allows.
    pub fn new(policy: AddressPolicy) -> Result<Self, EgressError> {
        let client = guarded_http::client_builder(policy)
            .timeout(std::time::Duration::from_secs(30 * 60))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|error| EgressError::Internal(rootcause::report!(error).into()))?;
        Ok(Self {
            policy,
            client: TracedClient(client),
            sessions: Mutex::new(lru::LruCache::new(
                NonZeroUsize::new(128).expect("pool capacity is positive"),
            )),
        })
    }

    async fn connection(
        &self,
        session: AgentSessionId,
        actor: MacroUserIdStr<'static>,
        upstream: UpstreamCall,
    ) -> Result<(AccountSession, Connection, Arc<Client>), EgressError> {
        guarded_http::check_url(self.policy, upstream.url())
            .map_err(|error| EgressError::Upstream(rootcause::report!(error).into()))?;
        let mut config = StreamableHttpClientTransportConfig::with_uri(upstream.url().to_string());
        for (name, value) in upstream.scope_headers() {
            config.custom_headers.insert(name.clone(), value.clone());
        }
        if let Some(value) = upstream.authorization().header_value()? {
            config
                .custom_headers
                .insert(http::header::AUTHORIZATION, value);
        }
        // Hash credentials for cache discrimination; never store/log plaintext keys.
        let mut fingerprint = Sha256::new();
        let mut headers: Vec<_> = config.custom_headers.iter().collect();
        headers.sort_by_key(|(name, _)| name.as_str());
        for (name, value) in headers {
            fingerprint.update(name.as_str().as_bytes());
            fingerprint.update([0]);
            fingerprint.update(value.as_bytes());
            fingerprint.update([0]);
        }
        let key = AccountSession {
            session,
            actor,
            endpoint: upstream.url().to_string(),
            credential: fingerprint.finalize().into(),
        };
        let cell = {
            let mut sessions = self.sessions.lock().map_err(|_| {
                EgressError::Internal(rootcause::report!("MCP session pool poisoned"))
            })?;
            if let Some(connection) = sessions.get(&key)
                && !connection.get().is_some_and(|client| client.is_closed())
            {
                Arc::clone(connection)
            } else {
                let cell = Arc::new(OnceCell::new());
                sessions.put(key.clone(), Arc::clone(&cell));
                cell
            }
        };
        let client = cell
            .get_or_try_init(|| {
                async {
                    let transport =
                        StreamableHttpClientTransport::with_client(self.client.clone(), config);
                    let client = tokio::time::timeout(
                        std::time::Duration::from_secs(30),
                        mcp_client::domain::models::client_info().serve(transport),
                    )
                    .await
                    .map_err(|error| EgressError::Upstream(rootcause::report!(error).into()))?
                    .map_err(handshake_error)?;
                    Ok(Arc::new(client))
                }
                // A new upstream session's handshake, apart from the call it serves.
                .instrument(tracing::info_span!("connected_app.mcp_connect"))
            })
            .await
            .cloned()?;
        Ok((key, cell, client))
    }

    /// Drop `cell` from the pool when it still holds `key`'s session, so the
    /// next request opens a new one.
    fn evict(&self, key: &AccountSession, cell: &Connection) {
        if let Ok(mut sessions) = self.sessions.lock()
            && sessions
                .peek(key)
                .is_some_and(|current| Arc::ptr_eq(current, cell))
        {
            sessions.pop(key);
        }
    }
}

#[async_trait::async_trait]
impl ActorMcpTransport for HttpActorMcpTransport {
    // The caller's `connected_app.mcp_exchange` span is the outbound span.
    async fn exchange(
        &self,
        session: AgentSessionId,
        actor: MacroUserIdStr<'static>,
        upstream: UpstreamCall,
        request: Value,
    ) -> Result<Value, EgressError> {
        let (key, cell, client) = self.connection(session, actor, upstream).await?;
        let result = match request["method"].as_str() {
            Some("tools/list") => client
                .list_all_tools()
                .await
                .map(|tools| serde_json::json!({"tools": tools}))
                .map_err(call_error),
            Some("tools/call") => {
                let mut params: rmcp::model::CallToolRequestParams =
                    serde_json::from_value(request["params"].clone())
                        .map_err(|error| EgressError::Internal(rootcause::report!(error).into()))?;
                let mut trace_headers = http::HeaderMap::new();
                macro_tower_layers::inject_trace_headers(&mut trace_headers);
                let meta = params.meta.get_or_insert_with(Default::default);
                for (name, value) in &trace_headers {
                    if let Ok(value) = value.to_str() {
                        meta.0
                            .insert(name.as_str().into(), Value::String(value.into()));
                    }
                }
                client
                    .call_tool(params)
                    .await
                    .map_err(call_error)
                    .and_then(|result| {
                        serde_json::to_value(result).map_err(|error| {
                            EgressError::Internal(rootcause::report!(error).into())
                        })
                    })
            }
            _ => Err(EgressError::Unauthenticated(
                "unsupported actor MCP exchange",
            )),
        };
        // A grant that needs reconnecting may come back with a new upstream
        // session behind it; the retry after a reconnect handshakes again.
        if matches!(result, Err(EgressError::NeedsReconnect)) {
            self.evict(&key, &cell);
        }
        result
    }
}

/// A failed handshake: a 409 the upstream answered means the account's
/// grant needs reconnecting; anything else broke the exchange.
fn handshake_error(error: rmcp::service::ClientInitializeError) -> EgressError {
    use rmcp::service::ClientInitializeError;
    // A discover-first startup that fell back to `initialize` failed twice;
    // the upstream answers both the same way.
    let transport = match &error {
        ClientInitializeError::TransportError { error, .. } => Some(error),
        ClientInitializeError::LegacyFallbackFailed { fallback, .. } => match fallback.as_ref() {
            ClientInitializeError::TransportError { error, .. } => Some(error),
            _ => None,
        },
        _ => None,
    };
    if transport.and_then(http_status) == Some(http::StatusCode::CONFLICT.as_u16()) {
        return EgressError::NeedsReconnect;
    }
    EgressError::Upstream(rootcause::report!(error).into())
}

/// A failed request on an open session: a 429 the upstream answered is a typed rate limit, since
/// the request did not run and may be sent again, and a 409 means the
/// account's grant needs reconnecting; anything else broke the exchange.
fn call_error(error: rmcp::ServiceError) -> EgressError {
    if let rmcp::ServiceError::TransportSend(transport) = &error
        && let Some(StreamableHttpError::HttpStatus(status)) = transport
            .error
            .downcast_ref::<StreamableHttpError<reqwest::Error>>()
    {
        if status.status == http::StatusCode::TOO_MANY_REQUESTS.as_u16() {
            return EgressError::RateLimited {
                retry_after: status.retry_after.as_deref().and_then(retry_after),
            };
        }
        if status.status == http::StatusCode::CONFLICT.as_u16() {
            return EgressError::NeedsReconnect;
        }
    }
    EgressError::Upstream(rootcause::report!(error).into())
}

/// The HTTP status a transport failure carries, when it carries one.
fn http_status(transport: &rmcp::transport::DynamicTransportError) -> Option<u16> {
    match transport
        .error
        .downcast_ref::<StreamableHttpError<reqwest::Error>>()?
    {
        StreamableHttpError::HttpStatus(status) => Some(status.status),
        _ => None,
    }
}

/// A `Retry-After` value as a wait: delay-seconds, or an HTTP date, which
/// counts from now (a date already past is no wait).
fn retry_after(value: &str) -> Option<std::time::Duration> {
    let value = value.trim();
    if let Ok(seconds) = value.parse() {
        return Some(std::time::Duration::from_secs(seconds));
    }
    let at = httpdate::parse_http_date(value).ok()?;
    Some(
        at.duration_since(std::time::SystemTime::now())
            .unwrap_or_default(),
    )
}
