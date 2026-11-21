//! The connector catalog consulted when an agent pins MCP servers, and the
//! connector backends (Pipedream plus Macro Connect) built from the
//! environment.

use std::sync::Arc;

use anyhow::Context;
use bots::domain::ports::{BotError, McpAppCatalog};
use macro_env::Environment;
use macro_env_var::maybe_env_var;
use pipedream_mcp::domain::ports::{ConnectRollout, ConnectorOverlays};
use pipedream_mcp::outbound::api::{
    DEFAULT_API_URL, DEFAULT_MCP_URL, PipedreamClient, PipedreamConfig,
};
use pipedream_mcp::outbound::connect::{ConnectAdapter, ConnectConfig};

use pipedream_mcp::outbound::dispatch::ConnectorBackends;
use pipedream_mcp::outbound::pg_connection_repo::PgConnectionRepo;
use std::collections::HashMap;
use std::sync::Mutex;

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
        /// PostHog project token; reads the `macro-connect` rollout.
        PosthogApiKey,
        /// Regional PostHog origin; defaults to the US origin.
        PosthogHost,
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
pub fn connector_backends_from_env(
    environment: Environment,
) -> anyhow::Result<Option<Arc<ConnectorBackends>>> {
    let Some(pipedream) = pipedream_client_from_env()? else {
        return Ok(None);
    };
    let env = PipedreamCatalogEnv::new();
    let connect = connect_adapter(
        env.connect_customer_key
            .as_ref()
            .and_then(|value| value.value()),
    )?;
    let mut backends = ConnectorBackends::new(pipedream, connect);
    if let Some(rollout) = macro_connect_rollout(
        env.posthog_api_key.as_ref().and_then(|value| value.value()),
        env.posthog_host.as_ref().and_then(|value| value.value()),
        environment,
    )? {
        backends = backends.with_rollout(rollout);
    }
    Ok(Some(Arc::new(backends)))
}

/// The PostHog flag that puts a user on Macro Connect alone. Keep in sync
/// with the web flag of the same key.
pub const MACRO_CONNECT_FLAG: &str = "macro-connect";

/// How long one user's flag answer is reused: every MCP connection asks.
const ROLLOUT_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// The `macro-connect` rollout read from PostHog, or `None` without a
/// PostHog key (nobody on Connect alone). Answers are cached per user for
/// [`ROLLOUT_TTL`]; a failed read answers `false`, keeping the user on
/// Pipedream.
pub fn macro_connect_rollout(
    api_key: Option<&str>,
    host: Option<&str>,
    environment: Environment,
) -> anyhow::Result<Option<ConnectRollout>> {
    let Some(api_key) = api_key.filter(|key| !key.is_empty()) else {
        return Ok(None);
    };
    let flags = feature_flags::outbound::posthog::PostHogFeatureFlags::new(
        host.unwrap_or("https://us.i.posthog.com"),
        api_key.to_owned(),
        std::time::Duration::from_secs(3),
        environment,
    )
    .map_err(|error| anyhow::anyhow!("invalid feature flag configuration: {error}"))?;
    Ok(Some(rollout_from(flags, MACRO_CONNECT_FLAG)))
}

fn rollout_from<F>(flags: F, flag: &'static str) -> ConnectRollout
where
    F: feature_flags::FeatureFlags + Clone + 'static,
{
    type Cache = HashMap<String, (bool, std::time::Instant)>;
    let cache: Arc<Mutex<Cache>> = Arc::default();
    Arc::new(move |user_id| {
        let flags = flags.clone();
        let cache = cache.clone();
        Box::pin(async move {
            let key = user_id.as_ref().to_owned();
            if let Some((on, at)) = cache.lock().ok().and_then(|cache| cache.get(&key).copied())
                && at.elapsed() < ROLLOUT_TTL
            {
                return on;
            }
            let on = match flags.load(&user_id).await {
                Ok(snapshot) => snapshot.is_enabled(flag),
                Err(error) => {
                    tracing::warn!(error = ?error, flag, "could not read a rollout flag; treating it as off");
                    return false;
                }
            };
            if let Ok(mut cache) = cache.lock() {
                cache.retain(|_, (_, at)| at.elapsed() < ROLLOUT_TTL);
                cache.insert(key, (on, std::time::Instant::now()));
            }
            on
        })
    })
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

/// Confirms agent MCP slugs against the connector catalog.
///
/// An app overlaid onto the native MCP stack (`mcp_overlays`, e.g. `github`)
/// is connectable without Pipedream, so it is accepted from the overlay table
/// alone. Any other slug is asked of Pipedream's app directory; with no
/// Pipedream client it is refused, because an unverified app is not stored.
#[derive(Clone)]
pub struct PipedreamMcpAppCatalog<O = PgConnectionRepo> {
    client: Option<Arc<PipedreamClient>>,
    overlays: O,
}

impl<O> PipedreamMcpAppCatalog<O> {
    /// Accept the apps `overlays` lists and consult `client` for the rest,
    /// refusing them when Pipedream is not configured.
    pub fn new(client: Option<Arc<PipedreamClient>>, overlays: O) -> Self {
        Self { client, overlays }
    }
}

impl PipedreamMcpAppCatalog {
    /// The catalog this process can consult: overlays from `pool`, and
    /// Pipedream when its credentials are in the environment.
    pub fn from_env(pool: sqlx::PgPool) -> anyhow::Result<Self> {
        Ok(Self::new(
            pipedream_client_from_env()?,
            PgConnectionRepo::new(pool),
        ))
    }
}

impl<O> std::fmt::Debug for PipedreamMcpAppCatalog<O> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PipedreamMcpAppCatalog")
            .field("configured", &self.client.is_some())
            .finish()
    }
}

impl<O: ConnectorOverlays> McpAppCatalog for PipedreamMcpAppCatalog<O> {
    async fn is_connectable_app(&self, slug: &str) -> Result<bool, BotError> {
        match self.overlays.overlay(slug).await {
            Ok(Some(_)) => return Ok(true),
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(%slug, error = ?error, "MCP overlay lookup failed");
                return Err(BotError::Unavailable(format!(
                    "could not verify MCP app {slug}"
                )));
            }
        }
        let Some(client) = &self.client else {
            return Err(BotError::Unavailable(format!(
                "cannot verify MCP app {slug}: Pipedream is not configured"
            )));
        };
        match client.retrieve_app(slug).await {
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
