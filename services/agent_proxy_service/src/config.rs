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
    /// Host runtimes should use to dial back into their provisioned,
    /// per-session WebSocket listener (the listener itself always binds
    /// every interface; only the advertised host varies by deployment).
    /// Defaults to `127.0.0.1` for local development.
    #[macro_config_default("127.0.0.1".to_string())]
    pub runtime_advertise_host: String,
    /// Start of the port range ephemeral per-session runtime listeners bind
    /// within. An OS-assigned port has no fixed mapping out of a container,
    /// so listeners bind inside this fixed, pre-published range instead.
    /// Defaults to `9700` (clear of the local stack's other published ports,
    /// e.g. Kafka on 9092 and OpenSearch on 9200/9600).
    #[macro_config_default(9700)]
    pub runtime_port_range_start: u16,
    /// End (inclusive) of the port range ephemeral runtime listeners bind
    /// within. Defaults to `9799` (100 ports; must match what's published to
    /// the host in `docker/docker-compose.yml`).
    #[macro_config_default(9799)]
    pub runtime_port_range_end: u16,
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
