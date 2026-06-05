use std::sync::LazyLock;

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
#[derive(serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
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
