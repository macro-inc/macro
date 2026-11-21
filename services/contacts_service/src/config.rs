use anyhow::Context;
use database_env_vars::{DatabaseUrl, RedisUri};
use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};

env_vars! {
    pub struct BaseUrl;
}

maybe_env_vars! {
    pub struct ContactsQueueMaxMessages;
    pub struct ContactsQueueWaitTimeSeconds;
    /// PostHog project key for the per-viewer `contacts-list-reads` flag.
    /// Unset or blank, every viewer reads the legacy directory.
    pub struct PosthogApiKey;
    /// PostHog host; PostHog's US origin when unset.
    pub struct PosthogHost;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// port number of service
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,
    /// The Redis URI for rate limiting.
    pub redis_uri: RedisUri,
    /// The notification queue max messages per poll
    pub contacts_queue_max_messages: ContactsQueueMaxMessages,
    /// The notification queue wait time seconds
    pub contacts_queue_wait_time_seconds: ContactsQueueWaitTimeSeconds,
    /// The internal api key value.
    pub internal_api_key: InternalApiKey,
    /// PostHog project key for backend feature flags (optional).
    pub posthog_api_key: PosthogApiKey,
    /// PostHog host (optional).
    pub posthog_host: PosthogHost,
}

impl Config {
    /// The PostHog project key, when one is configured. A blank value counts
    /// as none.
    pub fn posthog_api_key(&self) -> Option<&str> {
        self.posthog_api_key
            .value()
            .filter(|value| !value.trim().is_empty())
    }

    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load contacts service config")
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn new_testing() -> Self {
        Config {
            port: 0,
            environment: Environment::Local,
            database_url: DatabaseUrl::Comptime(""),
            redis_uri: RedisUri::Comptime(""),
            contacts_queue_max_messages: ContactsQueueMaxMessages::new_unset(),
            contacts_queue_wait_time_seconds: ContactsQueueWaitTimeSeconds::new_unset(),
            internal_api_key: InternalApiKey::Comptime(""),
            posthog_api_key: PosthogApiKey::new_unset(),
            posthog_host: PosthogHost::new_unset(),
        }
    }
}
