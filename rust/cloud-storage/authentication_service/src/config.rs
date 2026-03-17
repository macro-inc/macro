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

    /// FusionAuth Tenant Id
    pub fusionauth_tenant_id: String,
    /// FusionAuth API key secret name
    pub fusionauth_api_key_secret_key: String,
    /// FusionAuth client id
    pub fusionauth_client_id: String,
    /// FusionAuth client secret key
    pub fusionauth_client_secret_key: String,
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

    /// The internal auth key used by other services
    pub service_internal_auth_key: String,

    /// The document storage service url
    pub document_storage_service_url: String,

    /// The notification queue
    pub notification_queue: String,

    /// The search event queue
    pub search_event_queue: String,

    /// The stripe price id for the professional subscription
    pub stripe_price_id: String,

    /// The github client id
    pub github_client_id: String,
    /// The github client secret
    pub github_client_secret: String,
    /// The github idp id
    pub github_idp_id: String,

    /// GA4 Measurement ID (optional, e.g., "G-XXXXXXXXXX")
    pub ga_measurement_id: Option<String>,
    /// GA4 Measurement Protocol API secret (optional)
    pub ga_api_secret: Option<String>,

    /// Meta Pixel ID (optional)
    pub meta_pixel_id: Option<String>,
    /// Meta Conversions API access token (optional)
    pub meta_access_token: Option<String>,
    /// Meta test event code for testing (optional)
    pub meta_test_event_code: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("BASE_URL").context("BASE_URL must be provided")?;
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;

        let fusionauth_tenant_id = std::env::var("FUSIONAUTH_TENANT_ID")
            .context("FUSIONAUTH_TENANT_ID must be provided")?;
        let fusionauth_api_key_secret_key = std::env::var("FUSIONAUTH_API_KEY_SECRET_KEY")
            .context("FUSIONAUTH_API_KEY_SECRET_KEY must be provided")?;
        let fusionauth_client_id = std::env::var("FUSIONAUTH_CLIENT_ID")
            .context("FUSIONAUTH_CLIENT_ID must be provided")?;
        let fusionauth_client_secret_key = std::env::var("FUSIONAUTH_CLIENT_SECRET_KEY")
            .context("FUSIONAUTH_CLIENT_SECRET_KEY must be provided")?;
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

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;

        let notification_queue =
            std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        let stripe_price_id =
            std::env::var("STRIPE_PRICE_ID").context("STRIPE_PRICE_ID must be provided")?;

        let github_client_id =
            std::env::var("GITHUB_CLIENT_ID").context("GITHUB_CLIENT_ID must be provided")?;
        let github_client_secret = std::env::var("GITHUB_CLIENT_SECRET")
            .context("GITHUB_CLIENT_SECRET must be provided")?;
        let github_idp_id =
            std::env::var("GITHUB_IDP_ID").context("GITHUB_IDP_ID must be provided")?;

        // Google Analytics configuration
        let ga_measurement_id = std::env::var("GA_MEASUREMENT_ID").ok();
        let ga_api_secret = std::env::var("GA_API_SECRET").ok();

        // Meta Conversions API configuration
        let meta_pixel_id = std::env::var("META_PIXEL_ID").ok();
        let meta_access_token = std::env::var("META_ACCESS_TOKEN").ok();
        let meta_test_event_code = std::env::var("META_TEST_EVENT_CODE").ok();

        Ok(Config {
            base_url,
            database_url,
            redis_uri,
            fusionauth_tenant_id,
            fusionauth_api_key_secret_key,
            fusionauth_client_id,
            fusionauth_client_secret_key,
            fusionauth_base_url,
            fusionauth_oauth_redirect_uri,
            google_client_id,
            google_client_secret_key,
            stripe_secret_key,
            port,
            service_internal_auth_key,
            document_storage_service_url,
            notification_queue,
            search_event_queue,
            stripe_price_id,
            environment,
            github_client_id,
            github_client_secret,
            github_idp_id,
            ga_measurement_id,
            ga_api_secret,
            meta_pixel_id,
            meta_access_token,
            meta_test_event_code,
        })
    }
}
