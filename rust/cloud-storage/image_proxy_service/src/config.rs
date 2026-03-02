pub use macro_env::Environment;

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
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();
        let environment = Environment::new_or_prod();

        Ok(Config { port, environment })
    }
}
