use std::sync::LazyLock;

use anyhow::Context;
pub use macro_env::Environment;
use macro_service_urls::DocumentStorageServiceUrl;

use serde_json::Value;

fn read_config_value(key: &'static str) -> Option<String> {
    std::env::var("APP_SECRETS_JSON")
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|json| json.get(key).cloned())
        .map(|value| match value {
            Value::String(s) => s,
            other => other.to_string(),
        })
        .or_else(|| std::env::var(key).ok())
}

fn required_config_value(key: &'static str) -> anyhow::Result<String> {
    read_config_value(key).with_context(|| format!("{key} must be provided"))
}

fn optional_config_value(key: &'static str) -> Option<String> {
    read_config_value(key)
}

// BASE_URL config value. This is validated when creating the config in main.rs
pub static BASE_URL: LazyLock<String> = LazyLock::new(|| {
    read_config_value("BASE_URL").expect("BASE_URL must be provided via APP_SECRETS_JSON or env")
});

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

    /// The email link manager queue
    pub link_manager_queue: String,

    /// The email backfill queue. Used by `join_team` to enqueue a
    /// `PopulateCrmForUser` message that seeds CRM tables with the new
    /// member's historical sent-mail contacts.
    pub email_backfill_queue: String,

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

    /// PostHog API key (optional)
    pub posthog_api_key: Option<String>,
    /// PostHog host (optional)
    pub posthog_host: Option<String>,

    /// The stripe price id
    pub stripe_price_id: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = required_config_value("BASE_URL")?;
        let database_url = required_config_value("DATABASE_URL")?;
        let redis_uri = required_config_value("REDIS_URI")?;

        let fusionauth_tenant_id = required_config_value("FUSIONAUTH_TENANT_ID")?;
        let fusionauth_api_key_secret_key = required_config_value("FUSIONAUTH_API_KEY_SECRET_KEY")?;
        let fusionauth_client_id = required_config_value("FUSIONAUTH_CLIENT_ID")?;
        let fusionauth_client_secret_key = required_config_value("FUSIONAUTH_CLIENT_SECRET_KEY")?;
        let fusionauth_base_url = required_config_value("FUSIONAUTH_BASE_URL")?;
        let fusionauth_oauth_redirect_uri = required_config_value("FUSIONAUTH_OAUTH_REDIRECT_URI")?;

        let google_client_id = required_config_value("GOOGLE_CLIENT_ID")?;
        let google_client_secret_key = required_config_value("GOOGLE_CLIENT_SECRET_KEY")?;

        let stripe_secret_key = required_config_value("STRIPE_SECRET_KEY")?;

        let service_internal_auth_key = required_config_value("SERVICE_INTERNAL_AUTH_KEY")?;

        let port: usize = read_config_value("PORT")
            .unwrap_or_else(|| "8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let environment = Environment::new_or_prod();

        let document_storage_service_url = DocumentStorageServiceUrl::new()?.to_string();

        let notification_queue = required_config_value("NOTIFICATION_QUEUE")?;
        let search_event_queue = required_config_value("SEARCH_EVENT_QUEUE")?;
        let link_manager_queue = required_config_value("LINK_MANAGER_QUEUE")?;
        let email_backfill_queue = required_config_value("EMAIL_BACKFILL_QUEUE")?;

        let github_client_id = required_config_value("GITHUB_CLIENT_ID")?;
        let github_client_secret = required_config_value("GITHUB_CLIENT_SECRET")?;
        let github_idp_id = required_config_value("GITHUB_IDP_ID")?;

        let ga_measurement_id = optional_config_value("GA_MEASUREMENT_ID");
        let ga_api_secret = optional_config_value("GA_API_SECRET");

        let meta_pixel_id = optional_config_value("META_PIXEL_ID");
        let meta_access_token = optional_config_value("META_ACCESS_TOKEN");
        let meta_test_event_code = optional_config_value("META_TEST_EVENT_CODE");

        let posthog_api_key = optional_config_value("POSTHOG_API_KEY");
        let posthog_host = optional_config_value("POSTHOG_HOST");

        let stripe_price_id = required_config_value("STRIPE_PRICE_ID")?;

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
            link_manager_queue,
            email_backfill_queue,
            environment,
            github_client_id,
            github_client_secret,
            github_idp_id,
            ga_measurement_id,
            ga_api_secret,
            meta_pixel_id,
            meta_access_token,
            meta_test_event_code,
            posthog_api_key,
            posthog_host,
            stripe_price_id,
        })
    }
}
