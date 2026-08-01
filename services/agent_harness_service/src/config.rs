//! Configuration for the agent harness service, loaded via the standard
//! `macro_config` pattern.

use anyhow::Context;
pub use macro_env::Environment;
use macro_uuid::Uuid;

macro_env_var::env_vars!(
    /// Comma-separated Kafka bootstrap servers.
    #[derive(Clone)]
    pub struct KafkaBrokers;

    /// API key the Daytona client authenticates with. No `Debug` on
    /// purpose: the newtype cannot be formatted into logs by accident.
    #[derive(Clone)]
    pub struct DaytonaApiKey;

    /// Token with read access to the repo cloned into sandboxes.
    #[derive(Clone)]
    pub struct GithubToken;
);

/// The configuration parameters for the agent harness service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// Comma-separated Kafka bootstrap servers.
    pub kafka_brokers: KafkaBrokers,
    /// MacroDB connection string; `agent_sessions` lives here.
    pub database_url: String,
    /// Base URL of the Daytona REST API.
    #[macro_config_default(String::from("https://app.daytona.io/api"))]
    pub daytona_api_url: String,
    /// API key the Daytona client authenticates with.
    pub daytona_api_key: DaytonaApiKey,
    /// Name of the prebuilt Daytona snapshot to create sandboxes from. The
    /// image is expected to be built and pushed as a snapshot out of band,
    /// keeping image builds off the first-prompt critical path.
    pub daytona_snapshot: String,
    /// Token with read access to the repo cloned into sandboxes.
    pub github_token: GithubToken,
    /// The bot this deployment answers for.
    ///
    /// Configuration rather than a constant: `@claude` and `@codex` are separate
    /// deployments of this same binary, distinguished only by which bot id they
    /// watch for. It must be a real `bots` row - `agent_session.bot_id`
    /// references it.
    pub harness_bot_id: Uuid,
}

impl Config {
    /// Load the configuration from the environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent harness service config")
    }
}
