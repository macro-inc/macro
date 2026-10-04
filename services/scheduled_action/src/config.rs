//! Configuration for the agent schedule service, loaded via the standard
//! `macro_config` pattern so it gets a `doppler_config` validation binary.
//!
//! All required env vars are declared here as typed fields. The
//! `doppler_config` binary loads this `Config` from Doppler for both the dev
//! and prod environments, surfacing any missing or mistyped values at CI time.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::env_vars;

#[cfg(test)]
mod test;

env_vars! {
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
}

/// The configuration parameters for the agent schedule service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// Port to listen on. Defaults to `8080` when unset.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The connection URL for the Postgres database this application uses.
    pub database_url: DatabaseUrl,
    pub kafka_brokers: KafkaBrokers,
    /// Enables event-trigger management, Kafka intake, and pending dispatch together.
    /// Register EVENT_ROUTINES_ENABLED as a raw boolean in Doppler before rollout.
    #[macro_config_default(false)]
    pub event_routines_enabled: bool,
    /// Accept agent-target configuration only after all scheduler workers are upgraded.
    /// Register ROUTINE_AGENTS_ENABLED as a raw boolean in Doppler before rollout.
    #[macro_config_default(false)]
    pub routine_agents_enabled: bool,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent schedule service config")
    }
}
