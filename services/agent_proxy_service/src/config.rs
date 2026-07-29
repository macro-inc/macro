//! Configuration for the agent proxy service, loaded via the standard
//! `macro_config` pattern.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
use macro_auth::InternalApiKey;
pub use macro_env::Environment;

/// The configuration parameters for the agent proxy service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// Port the HTTP API listens on. Defaults to `8080` when unset.
    #[macro_config_default(8080)]
    pub port: usize,
    /// Host runtimes should use to dial back into the shared runtime
    /// WebSocket endpoint when `runtime_public_url` is unset. Only correct
    /// for a bare `cargo run` with nothing in front of it. Defaults to
    /// `127.0.0.1` for local development.
    #[macro_config_default("127.0.0.1".to_string())]
    pub runtime_advertise_host: String,
    /// Full scheme+host(+port) external runtimes should dial for the shared
    /// runtime WebSocket endpoint, e.g. `wss://agent-proxy.macro.com` behind
    /// a TLS-terminating load balancer, or `ws://localhost:8091` when the
    /// externally published port differs from this process's own `port`
    /// (as in local docker-compose). Unset locally by default, in which case
    /// `runtime_advertise_host`/`port` are used instead.
    pub runtime_public_url: Option<String>,
    /// The connection URL for the Postgres database this application uses.
    pub database_url: DatabaseUrl,
    /// The internal api key, used for the connection gateway client and
    /// internal request authorization.
    pub internal_api_key: InternalApiKey,
    /// Redis connection string backing the live-chat-stream repo (matches
    /// `document_cognition_service`'s `REDIS_HOST`).
    pub redis_host: String,
}

impl Config {
    /// Load the configuration from the environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent proxy service config")
    }
}
