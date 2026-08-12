//! Service configuration.

use anyhow::Context;
pub use macro_env::Environment;

/// Environment-derived configuration.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The port to listen on.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// Shared secret subscribers must present. Required: a tunnel that
    /// cannot authenticate subscribers must not start.
    pub calendar_watch_relay_secret: String,
}

impl Config {
    /// Load the configuration from the environment.
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load calendar event local tunnel config")
    }
}
