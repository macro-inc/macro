use crate::outbound::native::persisting_credential_store::PersistingCredentialStore;
use crate::outbound::native::ports::{McpConnector, McpServerHttp, McpServerStore};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::{McpServer, client_info};
use rmcp::service::{ClientInitializeError, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::auth::{AuthClient, StoredCredentials};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

#[cfg(test)]
mod test;

/// How long a server gets to answer the MCP initialize handshake.
///
/// A turn connects all of a user's servers concurrently and waits for every
/// one, so a server that accepts the request and never answers would hold up
/// tool loading for the whole turn. Initialize is a single small request that
/// a healthy server answers in well under a second. OAuth requests made before
/// it are bounded separately by the OAuth client's own timeouts.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// The server accepted the connection but did not finish the initialize
/// handshake within [`HANDSHAKE_TIMEOUT`].
#[derive(Debug, thiserror::Error)]
#[error("MCP server did not complete the initialize handshake within {0:?}")]
pub(crate) struct HandshakeTimedOut(pub Duration);

/// Run the initialize handshake under [`HANDSHAKE_TIMEOUT`], recording its
/// outcome on the current span. Only the handshake is bounded; the session it
/// returns stays open for as long as the caller keeps it.
async fn handshake(
    initialize: impl Future<Output = Result<McpServer, ClientInitializeError>>,
) -> anyhow::Result<McpServer> {
    let (outcome, result) = match tokio::time::timeout(HANDSHAKE_TIMEOUT, initialize).await {
        Ok(Ok(server)) => ("completed", Ok(server)),
        Ok(Err(error)) => ("failed", Err(error.into())),
        Err(_) => (
            "timed_out",
            Err(HandshakeTimedOut(HANDSHAKE_TIMEOUT).into()),
        ),
    };
    tracing::Span::current().record("handshake", outcome);
    result
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
    /// The server answered HTTP 401 to a request without a token, so it
    /// needs a sign-in. Only means something while `credentials` is `None`:
    /// signing in stores a grant and clears it.
    #[serde(default)]
    pub requires_sign_in: bool,
}

/// Open an MCP session to `url` with a fixed bearer token: a grant that
/// lives elsewhere (the GitHub account link) and is never refreshed here.
#[tracing::instrument(skip_all, err, fields(handshake = tracing::field::Empty))]
pub(crate) async fn dial_with_bearer(
    http: &impl McpServerHttp,
    url: &url::Url,
    bearer: &str,
) -> anyhow::Result<McpServer> {
    http.check_url(url)?;
    let config = StreamableHttpClientTransportConfig::with_uri(url.as_str()).auth_header(bearer);
    let transport = StreamableHttpClientTransport::with_client(http.transport(), config);
    handshake(client_info().serve(transport)).await
}

impl McpConnector for McpServerRecord {
    #[tracing::instrument(skip_all, err, fields(handshake = tracing::field::Empty))]
    async fn connect<S: McpServerStore>(
        &self,
        http: &impl McpServerHttp,
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

                handshake(client_info().serve(transport)).await
            }
            None => {
                let transport =
                    StreamableHttpClientTransport::with_client(http.transport(), config);
                handshake(client_info().serve(transport)).await
            }
        }
    }
}
