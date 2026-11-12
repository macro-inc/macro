use super::consts::MCP_CLIENT_NAME;
use crate::domain::ports::{McpConnector, McpServerStore};
use crate::domain::service::PersistingCredentialStore;
use crate::guarded_http::McpHttp;
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::RoleClient;
use rmcp::model::{ClientConfig, Implementation};
use rmcp::service::{RunningService, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::auth::{AuthClient, StoredCredentials};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// A connected MCP server session.
pub type McpServer = RunningService<RoleClient, ClientConfig>;

/// Build the client info sent to MCP servers during initialization.
pub fn client_info() -> ClientConfig {
    ClientConfig::new(
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
}

impl McpConnector for McpServerRecord {
    #[tracing::instrument(skip_all, err)]
    async fn connect<S: McpServerStore>(
        &self,
        http: &McpHttp,
        server_store: Arc<S>,
    ) -> anyhow::Result<McpServer> {
        http.check_url(&url::Url::parse(&self.url)?)?;
        let config = StreamableHttpClientTransportConfig::with_uri(&*self.url);
        match &self.credentials {
            Some(credentials) => {
                let mut auth_manager = http.authorization_manager(&self.url).await?;
                let store = PersistingCredentialStore::new(self.clone(), server_store);
                store.seed(credentials.clone()).await?;
                auth_manager.set_credential_store(store);
                auth_manager.initialize_from_store().await?;

                let auth_client = AuthClient::new(http.transport(), auth_manager);
                let transport = StreamableHttpClientTransport::with_client(auth_client, config);

                Ok(client_info().serve(transport).await?)
            }
            None => {
                let transport =
                    StreamableHttpClientTransport::with_client(http.transport(), config);
                Ok(client_info().serve(transport).await?)
            }
        }
    }
}
