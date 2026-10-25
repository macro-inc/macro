use anyhow::Context;
use macro_env_var::env_vars;
use uuid::Uuid;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub database_url: String,
    /// Links to backfill. When unset, every Outlook link is processed.
    pub link_ids: Option<Vec<Uuid>>,
    /// Number of links processed concurrently. Defaults to 1, capped at 50
    /// to bound DB connection usage.
    pub concurrency: usize,
    pub mode: Mode,
}

/// What the per-link pass does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Rewrite stale snippets (default).
    Apply,
    /// Read-only: count stale snippets. No writes.
    Verify,
}

impl Mode {
    /// What the per-link count means in log lines.
    pub fn noun(self) -> &'static str {
        match self {
            Mode::Apply => "updated",
            Mode::Verify => "stale",
        }
    }
}

env_vars! {
    struct DatabaseUrl;
    struct LinkIds;
    struct Concurrency;
    struct Verify;
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let link_ids = match LinkIds::new().ok() {
            Some(v) => Some(
                v.split(',')
                    .map(|id| Uuid::parse_str(id.trim()))
                    .collect::<Result<Vec<_>, _>>()
                    .context("LINK_IDS is not a comma-separated list of UUIDs")?,
            ),
            None => None,
        };
        let concurrency = match Concurrency::new().ok() {
            Some(v) => v
                .parse::<usize>()
                .context("CONCURRENCY is not a number")?
                .clamp(1, 50),
            None => 1,
        };
        let mode = match Verify::new().ok() {
            Some(v) if v.parse::<bool>().context("VERIFY is not a bool")? => Mode::Verify,
            _ => Mode::Apply,
        };

        Ok(Self {
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            link_ids,
            concurrency,
            mode,
        })
    }
}
