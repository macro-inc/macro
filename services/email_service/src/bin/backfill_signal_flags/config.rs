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
    /// What the per-link pass does; see [`BackfillMode`].
    pub mode: BackfillMode,
}

/// What the per-link pass does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BackfillMode {
    /// Flag matching threads true; never clears (default).
    SetTrueOnly,
    /// Clear + re-set per link so stale true flags are repaired.
    FullRecompute,
    /// Read-only: count threads whose is_signal disagrees with the
    /// heuristic. No writes.
    Verify,
}

env_vars! {
    struct MacroIds;
    struct DatabaseUrl;
    struct Concurrency;
    struct FullRecompute;
    struct Verify;
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
        let verify = match Verify::new().ok() {
            Some(v) => v.parse::<bool>().context("VERIFY is not a bool")?,
            None => false,
        };
        let mode = match (verify, full_recompute) {
            (true, true) => anyhow::bail!("VERIFY and FULL_RECOMPUTE are mutually exclusive"),
            (true, false) => BackfillMode::Verify,
            (false, true) => BackfillMode::FullRecompute,
            (false, false) => BackfillMode::SetTrueOnly,
        };

        Ok(Self {
            macro_ids: MacroIds::new().ok().map(|v| v.to_string()),
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            concurrency,
            mode,
        })
    }
}
