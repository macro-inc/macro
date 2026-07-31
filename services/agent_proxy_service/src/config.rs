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
