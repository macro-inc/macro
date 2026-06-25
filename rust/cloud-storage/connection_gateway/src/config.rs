use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;
use secretsmanager_client::LocalOrRemoteSecret;

env_vars! {
    pub struct MacroDbUrl;
    pub struct RedisHost;
}

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in cognitive-workspace root for details.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The port the service is running on
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    pub redis_host: RedisHost,
    pub macro_db_url: LocalOrRemoteSecret<MacroDbUrl>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load connection gateway config")
    }
}
