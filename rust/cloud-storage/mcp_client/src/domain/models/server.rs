use super::consts::MCP_CLIENT_NAME;
use crate::domain::ports::McpConnector;
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::RoleClient;
use rmcp::model::{ClientInfo, Implementation};
use rmcp::service::{RunningService, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::auth::{
    AuthClient, AuthorizationManager, CredentialStore as _, InMemoryCredentialStore,
    StoredCredentials,
};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde::{Deserialize, Serialize};

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
}

impl McpConnector for McpServerRecord {
    async fn connect(&self) -> anyhow::Result<McpServer> {
        match &self.credentials {
            Some(credentials) => {
                let mut auth_manager = AuthorizationManager::new(&self.url).await?;
                let store = InMemoryCredentialStore::new();
                store.save(credentials.clone()).await?;
                auth_manager.set_credential_store(store);
                auth_manager.initialize_from_store().await?;

                let auth_client = AuthClient::new(reqwest::Client::new(), auth_manager);
                let config = StreamableHttpClientTransportConfig::with_uri(&*self.url);
                let transport = StreamableHttpClientTransport::with_client(auth_client, config);

                Ok(client_info().serve(transport).await?)
            }
            None => {
                let transport = StreamableHttpClientTransport::from_uri(&*self.url);
                Ok(client_info().serve(transport).await?)
            }
        }
    }
}
