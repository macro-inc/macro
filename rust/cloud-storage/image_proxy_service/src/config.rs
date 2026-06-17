use anyhow::Context;

pub use macro_env::Environment;
use macro_env_var::maybe_env_vars;

maybe_env_vars! {
    struct Port;
}

/// The configuration parameters for the application.
#[derive(Debug)]
pub struct Config {
    /// The port to listen on
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port = Port::new()
            .map(|port| port.parse::<usize>().context("PORT must be a valid usize"))
            .transpose()?
            .unwrap_or(8080);
        let environment = Environment::new_or_prod();

        Ok(Config { port, environment })
    }
}
