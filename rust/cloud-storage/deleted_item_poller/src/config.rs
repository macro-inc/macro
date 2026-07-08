use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;

env_vars! {
    struct DatabaseUrl;
}

#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The environment we are in
    #[allow(dead_code)]
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();

        Ok(Config {
            database_url,
            environment: Environment::new_or_prod(),
        })
    }
}
