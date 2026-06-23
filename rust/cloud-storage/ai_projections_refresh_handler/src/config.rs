use anyhow::Context;
use macro_env_var::env_vars;

env_vars! {
    pub struct DatabaseUrl;
    pub struct AiProjectionQueue;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,

    /// The ai projection queue
    pub ai_projection_queue: AiProjectionQueue,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }
}
