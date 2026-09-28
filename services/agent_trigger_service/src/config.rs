//! Environment-backed service configuration.

use agent_trigger::domain::sources::TriggerEventSource;
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
    /// Key for internal service-to-service calls (the lexical service).
    pub internal_api_key: String,
    /// Which committed-post topic feeds the trigger: `messages` (the default,
    /// channel and document posts) or `channels` (the pre-parent channel
    /// event, kept until its producer retires it). Never both: every channel
    /// post is on both topics, so both would evaluate each mention twice.
    #[macro_config_default(TriggerEventSource::default())]
    pub agent_trigger_event_source: TriggerEventSource,
}

impl Config {
    /// Loads configuration from the process environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Self>()
            .context("failed to load agent trigger service config")
    }
}
