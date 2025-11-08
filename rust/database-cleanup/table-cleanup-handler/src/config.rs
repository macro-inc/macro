/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
#[derive(Debug)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// Table name to clean
    pub table_name: String,

    /// Max age of items in the table
    pub max_age_hours: u8,

    /// The environment we are in
    pub environment: Environment,
}

#[derive(Debug, Clone)]
pub enum Environment {
    PRODUCTION,
    DEVELOP,
    LOCAL,
}

impl Environment {
    fn from_str(environment: &str) -> Self {
        match environment {
            "prod" => Environment::PRODUCTION,
            "dev" => Environment::DEVELOP,
            "local" => Environment::LOCAL,
            _ => panic!("unsupported environment {}", environment),
        }
    }
}

impl Config {
    pub fn new(database_url: &str, table_name: &str, max_age_hours: u8, environment: &str) -> Self {
        Config {
            database_url: database_url.to_string(),
            table_name: table_name.to_string(),
            max_age_hours,
            environment: Environment::from_str(environment),
        }
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be provided");
        let table_name = std::env::var("TABLE_NAME").expect("TABLE_NAME must be provided");
        let max_age_hours = std::env::var("MAX_AGE_HOURS")
            .expect("MAX_AGE_HOURS must be provided")
            .parse::<u8>()
            .unwrap();

        let environment = std::env::var("ENVIRONMENT").unwrap_or("local".to_string());

        Ok(Config::new(
            database_url.as_str(),
            table_name.as_str(),
            max_age_hours,
            environment.as_str(),
        ))
    }
}
