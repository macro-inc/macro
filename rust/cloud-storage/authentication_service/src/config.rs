use std::sync::LazyLock;

use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};

// BASE_URL config value. This is validated when creating the config in main.rs
pub static BASE_URL: LazyLock<String> = LazyLock::new(|| {
    macro_config::required_config_value("BASE_URL")
        .expect("BASE_URL must be provided via APP_SECRETS_JSON or env")
});

env_vars! {
    pub struct BaseUrl;
    pub struct DatabaseUrl;
    pub struct RedisUri;
    pub struct FusionAuthTenantId;
    pub struct FusionAuthApiSecretKey;
    pub struct FusionAuthClientId;
    pub struct FusionAuthClientSecretKey;
    pub struct FusionAuthBaseUrl;
    pub struct FusionAuthOauthRedirectUri;
    pub struct GoogleClientId;
    pub struct GoogleClientSecretKey;
    pub struct StripeSecretKey;
    pub struct ServiceInternalAuthKey;
    pub struct NotificationQueue;
    pub struct SearchEventQueue;
    pub struct LinkManagerQueue;
    pub struct EmailBackfillQueue;
    pub struct GithubClientId;
    pub struct GithubClientSecret;
    pub struct GithubIdpId;
    pub struct StripePriceId;
}

maybe_env_vars! {
    pub struct GaMeasurementId;
    pub struct GaApiSecret;
    pub struct MetaPixelId;
    pub struct MetaAccessToken;
    pub struct MetaTestEventCode;
    pub struct PosthogApiKey;
    pub struct PosthogHost;
}

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
#[derive(macro_config::MacroConfig)]
// #[macro_config::from_ref_all]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    #[allow(dead_code)]
    pub base_url: BaseUrl,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,
    /// The Redis URI for the Redis this application should use.
    pub redis_uri: RedisUri,
    /// FusionAuth Tenant Id
    pub fusionauth_tenant_id: FusionAuthTenantId,
    /// FusionAuth API key secret name
    pub fusionauth_api_key_secret_key: FusionAuthApiSecretKey,
    /// FusionAuth client id
    pub fusionauth_client_id: FusionAuthClientId,
    /// FusionAuth client secret key
    pub fusionauth_client_secret_key: FusionAuthClientSecretKey,
    /// FusionAuth base url
    pub fusionauth_base_url: FusionAuthBaseUrl,
    /// FusionAuth oauth redirect uri
    pub fusionauth_oauth_redirect_uri: FusionAuthOauthRedirectUri,
    /// Google client id
    pub google_client_id: GoogleClientId,
    /// Google client secret key
    pub google_client_secret_key: GoogleClientSecretKey,
    /// Stripe secret key
    pub stripe_secret_key: StripeSecretKey,
    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The internal auth key used by other services
    pub service_internal_auth_key: ServiceInternalAuthKey,
    /// The notification queue
    pub notification_queue: NotificationQueue,
    /// The search event queue
    pub search_event_queue: SearchEventQueue,
    /// The email link manager queue
    pub link_manager_queue: LinkManagerQueue,
    /// The email backfill queue. Used by `join_team` to enqueue a
    /// `PopulateCrmForUser` message that seeds CRM tables with the new
    /// member's historical sent-mail contacts.
    pub email_backfill_queue: EmailBackfillQueue,
    /// The github client id
    pub github_client_id: GithubClientId,
    /// The github client secret
    pub github_client_secret: GithubClientSecret,
    /// The github idp id
    pub github_idp_id: GithubIdpId,
    /// GA4 Measurement ID (optional, e.g., "G-XXXXXXXXXX")
    pub ga_measurement_id: Option<GaMeasurementId>,
    /// GA4 Measurement Protocol API secret (optional)
    pub ga_api_secret: Option<GaApiSecret>,
    /// Meta Pixel ID (optional)
    pub meta_pixel_id: Option<MetaPixelId>,
    /// Meta Conversions API access token (optional)
    pub meta_access_token: Option<MetaAccessToken>,
    /// Meta test event code for testing (optional)
    pub meta_test_event_code: Option<MetaTestEventCode>,
    /// PostHog API key (optional)
    pub posthog_api_key: Option<PosthogApiKey>,
    /// PostHog host (optional)
    pub posthog_host: Option<PosthogHost>,
    /// The stripe price id
    pub stripe_price_id: StripePriceId,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load authentication service config")
    }
}
