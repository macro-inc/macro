use anyhow::Context;
pub use macro_env::Environment;

pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    /// For deployed applications, this is a secret stored in AWS Secrets Manager.
    pub database_url: String,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The search text extractor queue
    pub search_event_queue: String,
    /// The queue max messages per poll
    pub queue_max_messages: i32,
    /// The queue wait time seconds
    pub queue_wait_time_seconds: i32,

    /// The environment we are in
    pub environment: Environment,

    /// The URL for the Opensearch instance
    pub opensearch_url: String,
    /// The username for the Opensearch instance
    pub opensearch_username: String,
    /// The password for the Opensearch instance
    pub opensearch_password: String,

    /// The bucket where documents are stored
    pub document_storage_bucket: String,

    /// API key for sync service
    pub sync_service_auth_key: String,

    /// The email service URL
    pub email_service_url: String,

    /// The comms service URL
    pub comms_service_url: String,

    /// The number of workers to spawn
    pub worker_count: u8,

    /// The URL for the Lexical service
    pub lexical_service_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let environment = Environment::new_or_prod();

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        let queue_max_messages: i32 = std::env::var("QUEUE_MAX_MESSAGES")
            .unwrap_or("1".to_string())
            .parse::<i32>()
            .unwrap();

        let queue_wait_time_seconds: i32 = std::env::var("QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("20".to_string())
            .parse::<i32>()
            .unwrap();

        let opensearch_url =
            std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL must be provided")?;
        let opensearch_username =
            std::env::var("OPENSEARCH_USERNAME").context("OPENSEARCH_USERNAME must be provided")?;
        let opensearch_password =
            std::env::var("OPENSEARCH_PASSWORD").context("OPENSEARCH_PASSWORD must be provided")?;

        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?;

        let sync_service_auth_key = std::env::var("SYNC_SERVICE_AUTH_KEY")
            .context("SYNC_SERVICE_AUTH_KEY must be provided")?;

        let email_service_url =
            std::env::var("EMAIL_SERVICE_URL").context("EMAIL_SERVICE_URL must be provided")?;

        let comms_service_url =
            std::env::var("COMMS_SERVICE_URL").context("COMMS_SERVICE_URL must be provided")?;

        let worker_count: u8 = std::env::var("WORKER_COUNT")
            .unwrap_or("10".to_string())
            .parse::<u8>()
            .unwrap();

        let lexical_service_url =
            std::env::var("LEXICAL_SERVICE_URL").context("LEXICAL_SERVICE_URL must be provided")?;

        Ok(Config {
            database_url,
            port,
            search_event_queue,
            queue_max_messages,
            queue_wait_time_seconds,
            environment,
            opensearch_url,
            opensearch_username,
            opensearch_password,
            document_storage_bucket,
            sync_service_auth_key,
            email_service_url,
            comms_service_url,
            worker_count,
            lexical_service_url,
        })
    }
}
