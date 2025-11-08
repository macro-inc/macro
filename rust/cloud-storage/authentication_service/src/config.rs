use std::sync::LazyLock;

use anyhow::Context;
pub use macro_env::Environment;

// BASE_URL env var. This is validated when creating the config in main.rs
pub static BASE_URL: LazyLock<String> = LazyLock::new(|| std::env::var("BASE_URL").unwrap());

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
pub struct Config {
    #[allow(dead_code)]
    pub base_url: String,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,
    /// The Redis URI for the Redis this application should use.
    pub redis_uri: String,

    /// FusionAuth API key secret name
    pub fusionauth_api_key_secret_key: String,
    /// FusionAuth client id
    pub fusionauth_client_id: String,
    /// FusionAuth client secret key
    pub fusionauth_client_secret_key: String,
    /// FusionAuth application id
    pub fusionauth_application_id: String,
    /// FusionAuth base url
    pub fusionauth_base_url: String,
    /// FusionAuth oauth redirect uri
    pub fusionauth_oauth_redirect_uri: String,
    /// Google client id
    pub google_client_id: String,
    /// Google client secret key
    pub google_client_secret_key: String,

    /// Stripe secret key
    pub stripe_secret_key: String,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The environment we are in
    pub environment: Environment,

    /// The comms service url
    pub comms_service_url: String,

    /// The internal auth key used by other services
    pub service_internal_auth_key: String,

    /// The document storage service url
    pub document_storage_service_url: String,

    /// The notification service url
    pub notification_service_url: String,

    /// The notification queue
    pub notification_queue: String,

    /// The search event queue
    pub search_event_queue: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("BASE_URL").context("BASE_URL must be provided")?;
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;

        let fusionauth_api_key_secret_key = std::env::var("FUSIONAUTH_API_KEY_SECRET_KEY")
            .context("FUSIONAUTH_API_KEY_SECRET_KEY must be provided")?;
        let fusionauth_client_id = std::env::var("FUSIONAUTH_CLIENT_ID")
            .context("FUSIONAUTH_CLIENT_ID must be provided")?;
        let fusionauth_client_secret_key = std::env::var("FUSIONAUTH_CLIENT_SECRET_KEY")
            .context("FUSIONAUTH_CLIENT_SECRET_KEY must be provided")?;
        let fusionauth_application_id = std::env::var("FUSIONAUTH_APPLICATION_ID")
            .context("FUSIONAUTH_APPLICATION_ID must be provided")?;
        let fusionauth_base_url =
            std::env::var("FUSIONAUTH_BASE_URL").context("FUSIONAUTH_BASE_URL must be provided")?;
        let fusionauth_oauth_redirect_uri = std::env::var("FUSIONAUTH_OAUTH_REDIRECT_URI")
            .context("FUSIONAUTH_OAUTH_REDIRECT_URI must be provided")?;
        let google_client_id =
            std::env::var("GOOGLE_CLIENT_ID").context("GOOGLE_CLIENT_ID must be provided")?;
        let google_client_secret_key = std::env::var("GOOGLE_CLIENT_SECRET_KEY")
            .context("GOOGLE_CLIENT_SECRET_KEY must be provided")?;

        let stripe_secret_key =
            std::env::var("STRIPE_SECRET_KEY").context("STRIPE_SECRET_KEY must be provided")?;

        let service_internal_auth_key = std::env::var("SERVICE_INTERNAL_AUTH_KEY")
            .context("SERVICE_INTERNAL_AUTH_KEY environment variable not set")?;

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let environment = Environment::new_or_prod();
        let comms_service_url =
            std::env::var("COMMS_SERVICE_URL").context("COMMS_SERVICE_URL must be provided")?;

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;

        let notification_service_url = std::env::var("NOTIFICATION_SERVICE_URL")
            .context("NOTIFICATION_SERVICE_URL must be provided")?;

        let notification_queue =
            std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        Ok(Config {
            base_url,
            database_url,
            redis_uri,
            fusionauth_api_key_secret_key,
            fusionauth_client_id,
            fusionauth_client_secret_key,
            fusionauth_application_id,
            fusionauth_base_url,
            fusionauth_oauth_redirect_uri,
            google_client_id,
            google_client_secret_key,
            stripe_secret_key,
            port,
            comms_service_url,
            service_internal_auth_key,
            document_storage_service_url,
            notification_service_url,
            notification_queue,
            search_event_queue,
            environment,
        })
    }
}
