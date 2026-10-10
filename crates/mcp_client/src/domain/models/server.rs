use super::consts::MCP_CLIENT_NAME;
use crate::domain::ports::{McpConnector, McpServerStore};
use crate::domain::service::PersistingCredentialStore;
use http::{HeaderName, HeaderValue};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::RoleClient;
use rmcp::model::{ClientInfo, Implementation};
use rmcp::service::{RunningService, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::auth::{AuthClient, AuthorizationManager, StoredCredentials};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// A connected MCP server session.
pub type McpServer = RunningService<RoleClient, ClientInfo>;

/// Build the client info sent to MCP servers during initialization.
pub fn client_info() -> ClientInfo {
    ClientInfo::new(
        Default::default(),
        Implementation::new(MCP_CLIENT_NAME, env!("CARGO_PKG_VERSION")),
    )
}

/// Connection details for an MCP server.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct McpServerConnectionInfo {
    /// Human-readable server name.
    pub name: String,
    /// The server's streamable HTTP URL.
    pub url: String,
}

/// A persisted MCP server entry with connection info and credentials.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct McpServerRecord {
    /// The user who owns these credentials.
    pub user_id: MacroUserIdStr<'static>,
    /// The server URL these credentials authenticate against.
    pub url: String,
    /// Name of the MCP server.
    pub server_name: String,
    /// The OAuth credentials.
    #[serde(skip)]
    pub credentials: Option<StoredCredentials>,
    /// Whether the user has this toolset enabled.
    pub enabled: bool,
    /// Custom request headers to send with every request to this server.
    /// Stored as key-value pairs (e.g. `{"Authorization": "Bearer token123"}`).
    pub headers: HashMap<String, String>,
}

impl McpServerRecord {
    /// Build the transport config for this server, including any custom headers.
    fn transport_config(&self) -> StreamableHttpClientTransportConfig {
        let mut config = StreamableHttpClientTransportConfig::with_uri(&*self.url);
        if !self.headers.is_empty() {
            let custom_headers: HashMap<HeaderName, HeaderValue> = self
                .headers
                .iter()
                .filter_map(|(k, v)| {
                    let name = HeaderName::from_bytes(k.as_bytes()).ok()?;
                    let value = HeaderValue::from_str(v).ok()?;
                    Some((name, value))
                })
                .collect();
            if !custom_headers.is_empty() {
                config = config.custom_headers(custom_headers);
            }
        }
        config
    }
}

impl McpConnector for McpServerRecord {
    #[tracing::instrument(skip_all, err)]
    async fn connect<S: McpServerStore>(&self, server_store: Arc<S>) -> anyhow::Result<McpServer> {
        let config = self.transport_config();

        match &self.credentials {
            Some(credentials) => {
                let mut auth_manager = AuthorizationManager::new(&self.url).await?;
                let store = PersistingCredentialStore::new(self.clone(), server_store);
                store.seed(credentials.clone()).await?;
                auth_manager.set_credential_store(store);
                auth_manager.initialize_from_store().await?;

                let auth_client = AuthClient::new(reqwest::Client::new(), auth_manager);
                let transport = StreamableHttpClientTransport::with_client(auth_client, config);

                Ok(client_info().serve(transport).await?)
            }
            None => {
                // When there are no credentials, use the reqwest-based
                // transport with config (which includes custom headers).
                let transport = StreamableHttpClientTransport::from_config(config);
                Ok(client_info().serve(transport).await?)
            }
        }
    }
}
