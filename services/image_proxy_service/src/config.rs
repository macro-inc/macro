use anyhow::Context;
use macro_middleware::auth::internal_access::InternalApiKey;

pub use macro_env::Environment;

/// The configuration parameters for the application.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The port to listen on.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The internal API key used to authorize service requests.
    pub internal_api_key: InternalApiKey,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load image proxy service config")
    }
}
