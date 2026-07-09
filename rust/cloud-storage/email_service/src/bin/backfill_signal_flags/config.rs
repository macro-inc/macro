use anyhow::Context;
use macro_env_var::env_vars;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    /// Comma-separated macro IDs to backfill. When unset, every user with an
    /// email link is processed.
    pub macro_ids: Option<String>,
    pub database_url: String,
    /// Number of users processed concurrently. Defaults to 1, capped at 50
    /// to bound DB connection usage.
    pub concurrency: usize,
    /// When true, recomputes is_signal in both directions (clears stale true
    /// flags) instead of the default set-true-only pass.
    pub full_recompute: bool,
}

env_vars! {
    struct MacroIds;
    struct DatabaseUrl;
    struct Concurrency;
    struct FullRecompute;
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let concurrency = match Concurrency::new().ok() {
            Some(v) => v
                .parse::<usize>()
                .context("CONCURRENCY is not a number")?
                .clamp(1, 50),
            None => 1,
        };

        let full_recompute = match FullRecompute::new().ok() {
            Some(v) => v.parse::<bool>().context("FULL_RECOMPUTE is not a bool")?,
            None => false,
        };

        Ok(Self {
            macro_ids: MacroIds::new().ok().map(|v| v.to_string()),
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            concurrency,
            full_recompute,
        })
    }
}
