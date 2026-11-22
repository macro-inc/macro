//! The one place the crate's adapters are built: [`build`] turns a process's
//! configuration into [`Connectors`] over every source, the overlay table and
//! the rollout flag, and [`compose`] also into what the routes need beside
//! them: the app catalog and the server sign-ins the OAuth callback finishes.
//!
//! Call one of them once per process, at startup: the flag's cache, the
//! overlay table's cache and Connect's catalog cache live in what it builds.

use crate::domain::catalog::Overlays;
use crate::domain::discovery::{AppDirectory, Catalog};
use crate::domain::policy::MacroConnectFlag;
use crate::domain::ports::{OverlayCatalog, ServerDirectory, Source};
use crate::domain::service::Connectors;
use crate::outbound::app_directory::{HostedAppDirectory, NoAppDirectory};
use crate::outbound::github_link::GithubLinkSource;
use crate::outbound::github_link::auth_service::AuthServiceGithubLink;
use crate::outbound::guarded_http::{AddressPolicy, McpHttp};
use crate::outbound::hosted_connections::{HostedRepo, Provider, RevokeGrant};
use crate::outbound::macro_connect::{ConnectSource, ConnectVendorClient};
use crate::outbound::native::oauth::OAuthService;
use crate::outbound::native::pg_server_repo::PgServerRepo;
use crate::outbound::native::redis_state_store::RedisOAuthStateStore;
use crate::outbound::native::sign_in::OAuthSignIn;
use crate::outbound::native::source::NativeSource;
use crate::outbound::overlays::PgOverlayCatalog;
use crate::outbound::pipedream::api::PipedreamClient;
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

// The types a process fills [`ConnectorsConfig`] with, named here so the
// composition root never reaches into a source's module.
pub use crate::outbound::macro_connect::ConnectConfig;
pub use crate::outbound::native::models::{AesKey, OAuthClientMetadata};
#[cfg(feature = "providers")]
pub use crate::outbound::native::provider_registry::PreRegisteredProviders;
pub use crate::outbound::pipedream::api::{
    DEFAULT_API_URL as PIPEDREAM_DEFAULT_API_URL, DEFAULT_MCP_URL as PIPEDREAM_DEFAULT_MCP_URL,
    PipedreamConfig,
};

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

/// The catalog of connectable apps the `/connectors` routes and the
/// discovery tool browse.
pub type ConnectorCatalog = Catalog<Connectors>;

/// Finishing sign-ins to servers added by URL, which the OAuth callback
/// route runs.
pub use crate::domain::sign_in::ServerSignIns;

/// The connection services and what the routes need beside them, over one
/// set of adapters and caches.
pub struct Composed {
    /// The connection services.
    pub connectors: Connectors,
    /// The catalog of connectable apps, with statuses from `connectors`.
    pub catalog: ConnectorCatalog,
    /// Finishing sign-ins to servers by URL, for the OAuth callback route.
    pub sign_ins: ServerSignIns,
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
    compose(config, pool, redis, auth_service).map(|composed| composed.connectors)
}

/// [`build`], with the catalog and the server sign-ins the routes need.
///
/// The catalog is Pipedream's directory, whatever source a user connects an
/// app through; without Pipedream it is empty.
pub fn compose(
    config: ConnectorsConfig,
    pool: PgPool,
    redis: Arc<redis::Client>,
    auth_service: AuthServiceClient,
) -> Result<Composed, Report> {
    let http =
        McpHttp::new(AddressPolicy::for_environment(config.environment)).map_err(Report::new)?;

    // Native servers, signed in to with Macro's own OAuth client. GitHub's
    // row only keeps the link's toggle and name; the link source owns it.
    let servers = PgServerRepo::new(pool.clone(), config.mcp_credentials_key);
    let oauth = Arc::new(OAuthService::new(
        servers.clone(),
        RedisOAuthStateStore::new(redis),
        config.mcp_oauth_client.clone(),
        http.clone(),
        #[cfg(feature = "providers")]
        config.mcp_pre_registered,
    ));
    let sign_in = OAuthSignIn::new(Arc::clone(&oauth), &config.mcp_oauth_client)?;
    let servers = Arc::new(servers);
    let native = Arc::new(NativeSource::new(Arc::clone(&servers), oauth, http.clone()));
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

    let directory: Arc<dyn AppDirectory> = match &pipedream {
        Some(client) => Arc::new(HostedAppDirectory::new(client.clone())),
        None => Arc::new(NoAppDirectory),
    };

    let overlays = SharedOverlays(Arc::new(PgOverlayCatalog::new(pool)));
    let connectors = Connectors::new(
        sources,
        Some(native as Arc<dyn ServerDirectory>),
        MacroConnectFlag::new(flags),
        overlays.clone(),
    );

    Ok(Composed {
        catalog: Catalog::new(directory, connectors.clone()),
        sign_ins: ServerSignIns::new(Arc::new(sign_in), overlays),
        connectors,
    })
}

/// One overlay table and its cache, read by the services and the sign-ins.
#[derive(Clone)]
struct SharedOverlays(Arc<PgOverlayCatalog>);

impl OverlayCatalog for SharedOverlays {
    async fn overlays(&self) -> Result<Overlays, Report> {
        self.0.overlays().await
    }
}
