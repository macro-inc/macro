//! Configuration for the email focus worker, loaded with `macro_config` from
//! the email-service Doppler project it shares with the other email binaries.

use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};

env_vars! {
    /// The connection URL for the Macro database.
    pub struct MacroDbUrl;
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
    /// PostHog project key: names the project whose flag definitions the
    /// worker polls.
    pub struct PosthogApiKey;
    /// PostHog feature flags secure API key: lets the worker poll the
    /// `enable-email-focus` definition and evaluate it for each inbox's owner
    /// and the users it is linked to.
    pub struct PosthogFeatureFlagsSecureApiKey;
}

maybe_env_vars! {
    /// PostHog host; defaults to the project's US region.
    pub struct PosthogHost;
}

/// The email focus worker's configuration.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The connection URL for the Macro database.
    pub macro_db_url: MacroDbUrl,
    /// Kafka bootstrap servers; the worker reads `macro.email`.
    pub kafka_brokers: KafkaBrokers,
    /// Authenticates the worker's pushes to the connection gateway.
    pub internal_api_key: InternalApiKey,
    /// TypeSafe credential for Jev. While it is unset the worker classifies nothing.
    pub typesafe_api_key: jev::outbound::TypesafeApiKey,
    /// The PostHog project the Focus rollout's flag is in.
    pub posthog_api_key: PosthogApiKey,
    /// Reads the Focus rollout: an inbox is classified while the
    /// `enable-email-focus` flag of its owner, or of a user it is linked to,
    /// is on.
    pub posthog_feature_flags_secure_api_key: PosthogFeatureFlagsSecureApiKey,
    /// PostHog host (optional).
    pub posthog_host: PosthogHost,
    /// Seconds between sweeps for threads the event stream missed.
    #[macro_config_default(3600)]
    pub focus_sweep_interval_secs: u64,
    /// Days of mail the backfill and the sweep cover, at most 90.
    #[macro_config_default(30)]
    pub focus_window_days: u16,
}

impl Config {
    /// Load and validate the configuration from the environment.
    pub fn from_env() -> Result<Self, rootcause::Report> {
        Ok(macro_config::ConfigLoader::load::<Config>()?)
    }
}
