//! Pipedream app directory used when an agent pins MCP servers, and the
//! connector backends (Pipedream plus Macro Connect) built from the
//! environment.

use std::sync::Arc;

use anyhow::Context;
use bots::domain::ports::{BotError, McpAppCatalog};
use macro_env::Environment;
use macro_env_var::maybe_env_var;
use pipedream_mcp::domain::ports::ConnectorDirectory;
use pipedream_mcp::outbound::api::{
    DEFAULT_API_URL, DEFAULT_MCP_URL, PipedreamClient, PipedreamConfig,
};
use pipedream_mcp::outbound::connect::{ConnectAdapter, ConnectConfig};
use pipedream_mcp::outbound::dispatch::ConnectorBackends;

maybe_env_var! {
    struct PipedreamCatalogEnv {
        /// OAuth client ID for the Pipedream API.
        PipedreamClientId,
        /// OAuth client secret for the Pipedream API.
        PipedreamClientSecret,
        /// The Pipedream Connect project ID (`proj_...`).
        PipedreamProjectId,
        /// The Pipedream project environment (`development` or `production`).
        PipedreamEnvironment,
        /// Base URL of the Pipedream API.
        PipedreamApiUrl,
        /// Base URL of the Pipedream MCP server, shared with execution.
        PipedreamMcpUrl,
        /// Macro's customer key for the Macro Connect API.
        ConnectCustomerKey,
    }
}

/// The Macro Connect adapter for `customer_key`, or `None` when the host has
/// no key (Connect off). Connect sends consent back to the cognition
/// service's callback page, whichever host builds the adapter.
pub fn connect_adapter(customer_key: Option<&str>) -> anyhow::Result<Option<Arc<ConnectAdapter>>> {
    let Some(customer_key) = customer_key.filter(|key| !key.is_empty()) else {
        return Ok(None);
    };
    let public_url = macro_service_urls::CognitionPublicUrl::new()?;
    let callback_url = url::Url::parse(&format!(
        "{}/pipedream/mcp/connect/callback",
        public_url.as_str().trim_end_matches('/')
    ))
    .context("Connect callback is not a URL")?;
    let adapter = ConnectAdapter::new(ConnectConfig {
        api_url: macro_service_urls::ConnectApiUrl::new()?.to_string(),
        customer_key: customer_key.to_owned(),
        callback_url,
    })
    .context("building Macro Connect client")?;
    Ok(Some(Arc::new(adapter)))
}

/// Pipedream plus Macro Connect when this process has credentials for both
/// (Connect is optional), otherwise `None`.
pub fn connector_backends_from_env() -> anyhow::Result<Option<Arc<ConnectorBackends>>> {
    let Some(pipedream) = pipedream_client_from_env()? else {
        return Ok(None);
    };
    let env = PipedreamCatalogEnv::new();
    let connect = connect_adapter(
        env.connect_customer_key
            .as_ref()
            .and_then(|value| value.value()),
    )?;
    Ok(Some(Arc::new(ConnectorBackends::new(pipedream, connect))))
}

/// A Pipedream client when this process has the credentials, otherwise `None`.
///
/// Incomplete credentials are treated as unconfigured: a slug cannot be
/// half-verified.
pub fn pipedream_client_from_env() -> anyhow::Result<Option<Arc<PipedreamClient>>> {
    let env = PipedreamCatalogEnv::new();
    let (Some(client_id), Some(client_secret), Some(project_id)) = (
        env.pipedream_client_id
            .as_ref()
            .and_then(|value| value.value()),
        env.pipedream_client_secret
            .as_ref()
            .and_then(|value| value.value()),
        env.pipedream_project_id
            .as_ref()
            .and_then(|value| value.value()),
    ) else {
        return Ok(None);
    };

    let environment = env
        .pipedream_environment
        .as_ref()
        .and_then(|value| value.value())
        .map(str::to_owned)
        .unwrap_or_else(|| match Environment::new_or_prod() {
            Environment::Production => "production".to_owned(),
            Environment::Develop | Environment::Local => "development".to_owned(),
        });
    let api_url = env
        .pipedream_api_url
        .as_ref()
        .and_then(|value| value.value())
        .unwrap_or(DEFAULT_API_URL)
        .to_owned();

    let client = PipedreamClient::new(PipedreamConfig {
        client_id: client_id.to_owned(),
        client_secret: client_secret.to_owned(),
        project_id: project_id.to_owned(),
        environment,
        allowed_origins: Vec::new(),
        api_url,
        mcp_url: env
            .pipedream_mcp_url
            .as_ref()
            .and_then(|value| value.value())
            .unwrap_or(DEFAULT_MCP_URL)
            .to_owned(),
    })
    .context("building Pipedream client for MCP app lookup")?;
    Ok(Some(Arc::new(client)))
}

/// Confirms agent MCP slugs against Pipedream's app directory.
///
/// With no client, every slug is refused: an unverified app is not stored.
#[derive(Clone)]
pub struct PipedreamMcpAppCatalog {
    client: Option<Arc<PipedreamClient>>,
}

impl PipedreamMcpAppCatalog {
    /// Consult `client`, or refuse every slug when Pipedream is not configured.
    pub fn new(client: Option<Arc<PipedreamClient>>) -> Self {
        Self { client }
    }
}

impl std::fmt::Debug for PipedreamMcpAppCatalog {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PipedreamMcpAppCatalog")
            .field("configured", &self.client.is_some())
            .finish()
    }
}

impl McpAppCatalog for PipedreamMcpAppCatalog {
    async fn is_connectable_app(&self, slug: &str) -> Result<bool, BotError> {
        let Some(client) = &self.client else {
            return Err(BotError::Unavailable(format!(
                "cannot verify MCP app {slug}: Pipedream is not configured"
            )));
        };
        match client.retrieve(slug).await {
            Ok(Some(_)) => Ok(true),
            Ok(None) => Ok(false),
            Err(error) => {
                tracing::warn!(%slug, %error, "MCP app lookup failed");
                Err(BotError::Unavailable(format!(
                    "could not verify MCP app {slug}"
                )))
            }
        }
    }
}

#[cfg(test)]
mod test;
