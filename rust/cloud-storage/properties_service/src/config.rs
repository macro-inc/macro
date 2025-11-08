pub use macro_env::Environment;

/// Configuration parameters for the application.
#[derive(Debug)]
pub struct Config {
    /// The connection URL for the macrodb Postgres database (contains properties tables and permission tables)
    pub database_url: String,
    /// The port to listen for HTTP requests on.
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
    /// Comms service URL for channel permission checks
    pub comms_service_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be provided");
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();
        let environment = Environment::new_or_prod();
        let comms_service_url =
            std::env::var("COMMS_SERVICE_URL").expect("COMMS_SERVICE_URL must be provided");

        Ok(Config {
            database_url,
            port,
            environment,
            comms_service_url,
        })
    }
}
