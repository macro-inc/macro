use anyhow::Context;
pub use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in cognitive-workspace root for details.
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,
    /// The port to listen for HTTP requests on.
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
    /// internal auth key
    pub internal_auth_key: InternalApiSecretKey,
    /// url of the connection service
    pub connection_gateway_url: String,

    /// The SQS queue to send notifications to
    pub notification_queue: String,

    /// The url of the document storage service
    pub document_storage_service_url: String,

    /// The contacts SQS queue
    pub contacts_queue: String,

    /// Auth service client
    pub auth_service_url: String,

    /// Auth service secret key, used for internal access
    pub auth_service_secret_key: String,

    pub search_event_queue: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();
        let environment = Environment::new_or_prod();

        let internal_auth_key = InternalApiSecretKey::new()?;

        let connection_gateway_url = std::env::var("CONNECTION_GATEWAY_URL")
            .context("CONNECTION_GATEWAY_URL must be provided")?;

        let notification_queue =
            std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE must be provided")?;

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;

        let contacts_queue =
            std::env::var("CONTACTS_QUEUE").context("CONTACTS_QUEUE must be provided")?;

        let auth_service_url = std::env::var("AUTHENTICATION_SERVICE_URL")
            .context("AUTHENTICATION_SERVICE_URL must be provided")?;

        let auth_service_secret_key = std::env::var("AUTHENTICATION_SERVICE_SECRET_KEY")
            .context("AUTHENTICATION_SERVICE_SECRET_KEY must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        Ok(Config {
            database_url,
            port,
            environment,
            internal_auth_key,
            connection_gateway_url,
            notification_queue,
            document_storage_service_url,
            contacts_queue,
            auth_service_url,
            auth_service_secret_key,
            search_event_queue,
        })
    }
}
