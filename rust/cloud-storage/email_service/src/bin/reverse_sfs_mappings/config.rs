//! Configuration for the reverse_sfs_mappings binary.

use anyhow::Context;
use macro_env_var::{env_vars, maybe_env_vars};

/// Holds all configuration loaded from environment variables.
pub struct Config {
    /// Database connection URL.
    pub database_url: String,
    /// Optional comma-separated list of link_ids to filter by.
    pub link_ids: Option<Vec<uuid::Uuid>>,
    /// Batch size for processing messages.
    pub batch_size: i64,
    /// Starting offset for pagination (useful for pause/resume).
    pub offset: i64,
}

env_vars! {
    struct DatabaseUrl;
}

maybe_env_vars! {
    struct LinkIds;
    struct BatchSize;
    struct Offset;
}

fn parse_optional_env<T, V>(
    value: Option<V>,
    default: T,
    context: &'static str,
) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
    V: AsRef<str>,
{
    value
        .map(|value| value.as_ref().parse::<T>().context(context))
        .transpose()
        .map(|value| value.unwrap_or(default))
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    pub fn from_env() -> anyhow::Result<Self> {
        let link_ids = LinkIds::new()
            .map(|s| {
                s.split(',')
                    .map(|id| id.trim().parse::<uuid::Uuid>())
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()
            .context("LINK_IDS contains invalid UUIDs")?;

        let batch_size =
            parse_optional_env(BatchSize::new(), 10i64, "BATCH_SIZE is not a valid number")?;

        let offset = parse_optional_env(Offset::new(), 0i64, "OFFSET is not a valid number")?;

        Ok(Self {
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            link_ids,
            batch_size,
            offset,
        })
    }
}
