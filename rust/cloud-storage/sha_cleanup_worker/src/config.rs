pub use macro_env::Environment;

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
#[derive(Debug)]
pub struct Config {
    /// The connection URI for the redis cluster this application should use.
    pub redis_uri: String,

    /// The document storage s3 bucket
    pub document_storage_bucket: String,

    /// The macrodb database url
    pub database_url: String,

    /// The environment we are in
    pub environment: Environment,
}

impl Config {
    pub fn new(
        redis_uri: &str,
        database_url: &str,
        document_storage_bucket: &str,
        environment: Environment,
    ) -> Self {
        Config {
            redis_uri: redis_uri.to_string(),
            database_url: database_url.to_string(),
            document_storage_bucket: document_storage_bucket.to_string(),
            environment,
        }
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let redis_uri = std::env::var("REDIS_URI").expect("REDIS_URI must be provided");
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be provided");
        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .expect("DOCUMENT_STORAGE_BUCKET must be provided");
        let environment = Environment::new_or_prod();
        Ok(Config::new(
            redis_uri.as_str(),
            database_url.as_str(),
            document_storage_bucket.as_str(),
            environment,
        ))
    }
}
