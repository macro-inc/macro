//! The one place the crate's adapters are built: [`build`] turns a process's
//! configuration into [`Connectors`] over every source, the overlay table and
//! the rollout flag.
//!
//! Call it once per process, at startup: the flag's cache, the overlay
//! table's cache and Connect's catalog cache live in what it builds.

use crate::domain::policy::MacroConnectFlag;
use crate::domain::ports::{ServerDirectory, Source};
use crate::domain::service::Connectors;
use crate::outbound::github_link::GithubLinkSource;
use crate::outbound::github_link::auth_service::AuthServiceGithubLink;
use crate::outbound::hosted_connections::{HostedRepo, Provider, RevokeGrant};
use crate::outbound::macro_connect::{ConnectConfig, ConnectSource, ConnectVendorClient};
use crate::outbound::native::NativeSource;
use crate::outbound::native::domain::models::{AesKey, OAuthClientMetadata};
#[cfg(feature = "providers")]
use crate::outbound::native::domain::provider_registry::PreRegisteredProviders;
use crate::outbound::native::outbound::guarded_http::{AddressPolicy, McpHttp};
use crate::outbound::native::outbound::oauth::OAuthService;
use crate::outbound::native::outbound::pg_server_repo::PgServerRepo;
use crate::outbound::native::outbound::redis_state_store::RedisOAuthStateStore;
use crate::outbound::overlays::PgOverlayCatalog;
use crate::outbound::pipedream::outbound::api::{PipedreamClient, PipedreamConfig};
use crate::outbound::pipedream::source::PipedreamSource;
use authentication_service_client::AuthServiceClient;
use feature_flags::outbound::posthog::PostHogFeatureFlags;
use macro_env::Environment;
use rootcause::Report;
use rootcause::compat::IntoRootcause as _;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

#[cfg(test)]
mod test;

/// How long one read of the rollout flag may take before it counts as off.
const FLAG_READ_TIMEOUT: Duration = Duration::from_secs(3);

/// What [`build`] needs from the process's configuration.
pub struct ConnectorsConfig {
    /// Where this process runs: which addresses user servers may resolve
    /// to, and the flag provider's targeting.
    pub environment: Environment,
    /// The web app's origin, where a user links GitHub.
    pub app_origin: Url,
    /// The key native servers' credentials are encrypted with.
    pub mcp_credentials_key: AesKey,
    /// The OAuth client Macro signs in to native servers as.
    pub mcp_oauth_client: OAuthClientMetadata,
    /// Native servers that take Macro's registered client instead of
    /// registering one on the fly.
    #[cfg(feature = "providers")]
    pub mcp_pre_registered: PreRegisteredProviders,
    /// Pipedream, when this process has its credentials.
    pub pipedream: Option<PipedreamSettings>,
    /// Macro Connect, when this process has its key.
    pub connect: Option<ConnectConfig>,
    /// The flag provider, when this process has its key. Without one,
    /// nobody is on Macro Connect.
    pub feature_flags: Option<FeatureFlagsConfig>,
}

/// Pipedream's client settings, and where it reports connect-flow outcomes.
pub struct PipedreamSettings {
    /// The client.
    pub client: PipedreamConfig,
    /// The webhook Pipedream posts connect-flow outcomes to, when this
    /// process serves one.
    pub webhook_uri: Option<String>,
}

/// The PostHog project the rollout flag is read from.
pub struct FeatureFlagsConfig {
    /// The project's regional ingestion origin.
    pub host: String,
    /// The project token.
    pub api_key: String,
}

/// The connection services over every source this process is configured
/// for.
///
/// Native servers and the GitHub link are always on; Pipedream and Macro
/// Connect only with their credentials.
pub fn build(
    config: ConnectorsConfig,
    pool: PgPool,
    redis: Arc<redis::Client>,
    auth_service: AuthServiceClient,
) -> Result<Connectors, Report> {
    let http =
        McpHttp::new(AddressPolicy::for_environment(config.environment)).map_err(Report::new)?;

    // Native servers, signed in to with Macro's own OAuth client. GitHub's
    // row only keeps the link's toggle and name; the link source owns it.
    let servers = PgServerRepo::new(pool.clone(), config.mcp_credentials_key);
    let oauth = OAuthService::new(
        servers.clone(),
        RedisOAuthStateStore::new(redis),
        config.mcp_oauth_client,
        http.clone(),
        #[cfg(feature = "providers")]
        config.mcp_pre_registered,
    );
    let servers = Arc::new(servers);
    let native = Arc::new(NativeSource::new(
        Arc::clone(&servers),
        Arc::new(oauth),
        http.clone(),
    ));
    let github = GithubLinkSource::new(
        Arc::new(AuthServiceGithubLink::new(auth_service)),
        servers,
        http,
        &config.app_origin,
    )?;

    // Pipedream and Connect share one table keyed by user and app, so each
    // revokes the other's grant when a connection through it replaces one.
    let pipedream = match config.pipedream {
        Some(settings) => {
            let client = PipedreamClient::new(settings.client).into_rootcause()?;
            let client = match settings.webhook_uri {
                Some(uri) => client.with_webhook_uri(uri),
                None => client,
            };
            Some(Arc::new(client))
        }
        None => None,
    };
    let connect = config
        .connect
        .map(ConnectVendorClient::new)
        .transpose()?
        .map(Arc::new);

    let mut sources: Vec<Arc<dyn Source>> = vec![native.clone(), Arc::new(github)];
    if let Some(client) = &pipedream {
        let connect_grants = connect
            .clone()
            .map(|connect| connect as Arc<dyn RevokeGrant>);
        sources.push(Arc::new(PipedreamSource::new(
            client.clone(),
            HostedRepo::new(pool.clone(), Provider::Pipedream),
            connect_grants,
        )));
    }
    if let Some(vendor) = connect {
        let pipedream_grants = pipedream
            .clone()
            .map(|client| client as Arc<dyn RevokeGrant>);
        sources.push(Arc::new(ConnectSource::new(
            vendor,
            HostedRepo::new(pool.clone(), Provider::Connect),
            pipedream_grants,
        )));
    }

    let flags = config
        .feature_flags
        .map(|flags| {
            PostHogFeatureFlags::new(
                &flags.host,
                flags.api_key,
                FLAG_READ_TIMEOUT,
                config.environment,
            )
        })
        .transpose()?;

    Ok(Connectors::new(
        sources,
        Some(native as Arc<dyn ServerDirectory>),
        MacroConnectFlag::new(flags),
        PgOverlayCatalog::new(pool),
    ))
}
