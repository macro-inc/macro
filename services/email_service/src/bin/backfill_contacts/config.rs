use anyhow::Context;
use email_service::config::Environment;
use macro_env_var::{env_vars, maybe_env_vars};

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub macro_ids: String,
    pub database_url: String,
    pub environment: Environment,
    /// PostHog project key the `contacts-list-writes` flag is read with;
    /// without one, only legacy contacts messages are sent.
    pub posthog_api_key: Option<PosthogApiKey>,
    pub posthog_host: Option<PosthogHost>,
}

env_vars! {
    struct MacroIds;
    struct DatabaseUrl;
}

maybe_env_vars! {
    pub struct PosthogApiKey;
    pub struct PosthogHost;
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            macro_ids: MacroIds::new().context("MACRO_IDS not set")?.to_string(),
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            environment: Environment::new_or_prod(),
            posthog_api_key: PosthogApiKey::new(),
            posthog_host: PosthogHost::new(),
        })
    }
}
