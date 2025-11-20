use anyhow::Context;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub macro_ids: String,
    pub database_url: String,
    pub contacts_queue: String,
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            macro_ids: std::env::var("MACRO_IDS").context("MACRO_IDS not set")?, // Changed
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            contacts_queue: std::env::var("CONTACTS_QUEUE").context("CONTACTS_QUEUE not set")?,
        })
    }
}
