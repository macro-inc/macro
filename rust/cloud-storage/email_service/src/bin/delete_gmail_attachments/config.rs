use anyhow::Context;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub dss_url: String,
    pub internal_auth_key: String,
    pub macro_ids: String,
    pub database_url: String,
    pub delete_concurrency: usize,
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let delete_concurrency =
            std::env::var("DELETE_CONCURRENCY").context("DELETE_CONCURRENCY not set")?;
        let delete_concurrency = delete_concurrency
            .parse::<usize>()
            .context("DELETE_CONCURRENCY is not a number")?;

        Ok(Self {
            dss_url: std::env::var("DSS_URL").context("DSS_URL not set")?,
            internal_auth_key: std::env::var("INTERNAL_AUTH_KEY")
                .context("INTERNAL_AUTH_KEY not set")?,
            macro_ids: std::env::var("MACRO_IDS").context("MACRO_IDS not set")?, // Changed
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            delete_concurrency,
        })
    }
}
