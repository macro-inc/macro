//! Configuration for the agent harness service, loaded via the standard
//! `macro_config` pattern.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
pub use macro_env::Environment;
use macro_uuid::Uuid;

macro_env_var::env_vars!(
    /// Comma-separated Kafka bootstrap servers.
    #[derive(Clone)]
    pub struct KafkaBrokers;
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
    pub database_url: DatabaseUrl,
    /// Base URL of the Daytona REST API.
    #[macro_config_default(String::from("https://app.daytona.io/api"))]
    pub daytona_api_url: String,
    /// API key the Daytona client authenticates with. Empty means the
    /// managed (sandbox-provisioning) path is unarmed: external sessions
    /// still work, and a managed spawn fails loudly at spawn time.
    #[macro_config_default(String::new())]
    pub daytona_api_key: String,
    /// Name of the prebuilt Daytona snapshot to create sandboxes from. The
    /// image is expected to be built and pushed as a snapshot out of band,
    /// keeping image builds off the first-prompt critical path.
    #[macro_config_default(String::from("macro-agent-harness"))]
    pub daytona_snapshot: String,
    /// Token with read access to the repo cloned into sandboxes. Empty
    /// means managed sandboxes cannot clone; external sessions are
    /// unaffected.
    #[macro_config_default(String::new())]
    pub github_token: String,
    /// Run sandboxes on the local Docker daemon instead of Daytona.
    ///
    /// Default off: a deployed harness must keep using Daytona even if this
    /// binary is started with a copied local env file. `just run_local` sets
    /// it. Refused at boot unless `ENVIRONMENT=local`, because this path
    /// drives the host Docker daemon over a mounted socket.
    #[macro_config_default(false)]
    pub dev_dangerous_local_containers: bool,
    /// `docker`-compatible binary the local provider drives.
    #[macro_config_default(String::from("docker"))]
    pub local_container_docker_binary: String,
    /// Image the local provider creates sandboxes from.
    #[macro_config_default(String::from("macro-agent-harness:latest"))]
    pub local_container_image: String,
    /// Compose network local sandboxes join so this service can dial them.
    ///
    /// Required when `dev_dangerous_local_containers` is on: the harness is
    /// itself a container, so the address that works is one on a network both
    /// share. `just run_local` sets `{project}_services`.
    #[macro_config_default(String::new())]
    pub local_container_network: String,
    /// The bot this deployment answers for.
    ///
    /// Configuration rather than a constant: `@claude` and `@codex` are separate
    /// deployments of this same binary, distinguished only by which bot id they
    /// watch for. It must be a real `bots` row - `agent_session.bot_id`
    /// references it.
    pub harness_bot_id: Uuid,
    /// Model slug stamped onto sessions this deployment opens.
    #[macro_config_default(String::from("claude"))]
    pub harness_model: String,
    /// Harness slug stamped onto sessions this deployment opens.
    #[macro_config_default(String::from("opencode"))]
    pub harness_slug: String,
    /// Repository sessions run against, until it becomes per-request data.
    #[macro_config_default(String::from("https://github.com/macro-inc/macro"))]
    pub harness_repo_url: String,
    /// Key for internal service-to-service calls (the connection gateway).
    pub internal_api_key: String,
    /// Port the control routes are served on.
    #[macro_config_default(8101)]
    pub port: u16,
}

impl Config {
    /// Load the configuration from the environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent harness service config")
    }
}
