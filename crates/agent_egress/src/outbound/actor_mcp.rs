//! Preserve MCP state within an account without sharing it between accounts.
use crate::domain::{
    error::EgressError,
    model::{AgentSessionId, UpstreamCall},
    ports::ActorMcpTransport,
};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::{ServiceExt, model::ClientInfo, transport::StreamableHttpClientTransport};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex},
};
use tokio::sync::OnceCell;

mod traced_client;
use traced_client::TracedClient;
#[cfg(test)]
mod test;

type Client = rmcp::service::RunningService<rmcp::RoleClient, ClientInfo>;
type Connection = Arc<OnceCell<Arc<Client>>>;

#[derive(Hash, PartialEq, Eq)]
struct AccountSession {
    session: AgentSessionId,
    actor: MacroUserIdStr<'static>,
    endpoint: String,
    credential: [u8; 32],
}

/// A bounded pool isolated by session, selected user, endpoint, and credential.
pub struct HttpActorMcpTransport {
    client: TracedClient,
    sessions: Mutex<lru::LruCache<AccountSession, Connection>>,
}

impl HttpActorMcpTransport {
    /// Reuse an HTTP client with bounded requests and no credential-bearing redirects.
    pub fn new() -> Result<Self, EgressError> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30 * 60))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|error| EgressError::Internal(rootcause::report!(error).into()))?;
        Ok(Self {
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
    ) -> Result<Arc<Client>, EgressError> {
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
                sessions.put(key, Arc::clone(&cell));
                cell
            }
        };
        cell.get_or_try_init(|| async {
            let transport = StreamableHttpClientTransport::with_client(self.client.clone(), config);
            let client = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                ClientInfo::default().serve(transport),
            )
            .await
            .map_err(|error| EgressError::Upstream(rootcause::report!(error).into()))?
            .map_err(|error| EgressError::Upstream(rootcause::report!(error).into()))?;
            Ok(Arc::new(client))
        })
        .await
        .cloned()
    }
}

#[async_trait::async_trait]
impl ActorMcpTransport for HttpActorMcpTransport {
    #[tracing::instrument(skip_all, err, fields(session_id = %session, host = upstream.url().host_str()))]
    async fn exchange(
        &self,
        session: AgentSessionId,
        actor: MacroUserIdStr<'static>,
        upstream: UpstreamCall,
        request: Value,
    ) -> Result<Value, EgressError> {
        let client = self.connection(session, actor, upstream).await?;
        match request["method"].as_str() {
            Some("tools/list") => client
                .list_all_tools()
                .await
                .map(|tools| serde_json::json!({"tools": tools}))
                .map_err(|error| EgressError::Upstream(rootcause::report!(error).into())),
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
                    .map_err(|error| EgressError::Upstream(rootcause::report!(error).into()))
                    .and_then(|result| {
                        serde_json::to_value(result).map_err(|error| {
                            EgressError::Internal(rootcause::report!(error).into())
                        })
                    })
            }
            _ => Err(EgressError::Unauthenticated(
                "unsupported actor MCP exchange",
            )),
        }
    }
}
