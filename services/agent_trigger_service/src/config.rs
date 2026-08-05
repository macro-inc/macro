//! Environment-backed service configuration.

use anyhow::Context as _;
use database_env_vars::DatabaseUrl;
use macro_env_var::env_vars;

env_vars! {
    /// Comma-separated Kafka bootstrap servers.
    pub struct KafkaBrokers;
}

/// Configuration required by the agent trigger worker.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// MacroDB connection URL.
    pub database_url: DatabaseUrl,
    /// Kafka bootstrap servers.
    pub kafka_brokers: KafkaBrokers,
}

impl Config {
    /// Loads configuration from the process environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Self>()
            .context("failed to load agent trigger service config")
    }
}
