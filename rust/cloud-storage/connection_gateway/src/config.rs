use anyhow::Result;
pub use macro_env::Environment;
use macro_env_var::env_var;

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in cognitive-workspace root for details.
pub struct Config {
    /// The port the service is running on
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
    pub redis_host: RedisHost,
}

env_var!(
    pub struct EnvVars {
        pub RedisHost,
    }
);

env_var!(
    struct Port;
);

impl Config {
    pub fn from_env(env_vars: EnvVars) -> Self {
        let port: usize = Port::new()
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8080);

        let environment = Environment::new_or_prod();

        let EnvVars { redis_host } = env_vars;

        Config {
            port,
            environment,
            redis_host,
        }
    }
}
