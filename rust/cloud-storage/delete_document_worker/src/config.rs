use anyhow::Context;
pub use macro_env::Environment;

#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The connection URI for the redis cluster this application should use.
    pub redis_uri: String,

    /// The document storage s3 bucket
    pub document_storage_bucket: String,

    /// The queue to use for the delete document worker
    pub delete_document_queue: String,
    pub queue_max_messages: i32,
    pub queue_wait_time_seconds: i32,

    /// The environment we are in
    pub environment: Environment,

    pub port: usize,

    pub comms_service_auth_key: String,

    pub comms_service_url: String,

    /// API key for sync service
    pub sync_service_auth_key: String,

    /// sync service URL
    pub sync_service_url: String,

    /// Properties service auth key
    pub properties_service_auth_key: String,

    /// Properties service URL
    pub properties_service_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;
        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?;

        let delete_document_queue = std::env::var("DELETE_DOCUMENT_QUEUE")
            .context("DELETE_DOCUMENT_QUEUE must be provided")?;

        let queue_max_messages: i32 = std::env::var("QUEUE_MAX_MESSAGES")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let queue_wait_time_seconds: i32 = std::env::var("QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("4".to_string())
            .parse::<i32>()
            .unwrap();

        let environment = Environment::new_or_prod();

        let port = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("PORT must be a valid number")?;

        let comms_service_auth_key = std::env::var("COMMS_SERVICE_AUTH_KEY")
            .context("COMMS_SERVICE_AUTH_KEY must be provided")?;

        let comms_service_url =
            std::env::var("COMMS_SERVICE_URL").context("COMMS_SERVICE_URL must be provided")?;

        let sync_service_auth_key = std::env::var("SYNC_SERVICE_AUTH_KEY")
            .context("SYNC_SERVICE_AUTH_KEY must be provided")?;

        let sync_service_url =
            std::env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be provided")?;

        let properties_service_auth_key = std::env::var("PROPERTIES_SERVICE_AUTH_KEY")
            .context("PROPERTIES_SERVICE_AUTH_KEY must be provided")?;

        let properties_service_url = std::env::var("PROPERTIES_SERVICE_URL")
            .context("PROPERTIES_SERVICE_URL must be provided")?;

        Ok(Config {
            database_url,
            redis_uri,
            document_storage_bucket,
            queue_max_messages,
            queue_wait_time_seconds,
            environment,
            port,
            delete_document_queue,
            comms_service_auth_key,
            comms_service_url,
            sync_service_auth_key,
            sync_service_url,
            properties_service_auth_key,
            properties_service_url,
        })
    }
}
