use macro_env_var::{env_vars, maybe_env_vars};
use rootcause::prelude::{Report, ResultExt as _};
use uuid::Uuid;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub database_url: DatabaseUrl,
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

env_vars! {
    pub struct DatabaseUrl;
}

maybe_env_vars! {
    struct LinkIds;
    struct Concurrency;
    struct Verify;
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> Result<Self, Report> {
        let link_ids = LinkIds::new()
            .map(|ids| {
                ids.split(',')
                    .map(|id| Uuid::parse_str(id.trim()))
                    .collect::<Result<Vec<_>, _>>()
                    .context("LINK_IDS is not a comma-separated list of UUIDs")
            })
            .transpose()?;
        let concurrency = Concurrency::new()
            .map(|n| n.parse::<usize>().context("CONCURRENCY is not a number"))
            .transpose()?
            .map_or(1, |n| n.clamp(1, 50));
        let verify = Verify::new()
            .map(|v| v.parse::<bool>().context("VERIFY is not a bool"))
            .transpose()?;

        Ok(Self {
            database_url: DatabaseUrl::new()?,
            link_ids,
            concurrency,
            mode: if verify == Some(true) {
                Mode::Verify
            } else {
                Mode::Apply
            },
        })
    }
}
