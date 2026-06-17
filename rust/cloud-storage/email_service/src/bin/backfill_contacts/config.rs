use anyhow::Context;
use macro_env_var::env_vars;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub macro_ids: String,
    pub database_url: String,
    pub contacts_queue: String,
}

env_vars! {
    struct MacroIds;
    struct DatabaseUrl;
    struct ContactsQueue;
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
            contacts_queue: ContactsQueue::new()
                .context("CONTACTS_QUEUE not set")?
                .to_string(),
        })
    }
}
