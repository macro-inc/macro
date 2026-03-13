//! Configuration for the reverse_sfs_mappings binary.

use anyhow::Context;

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

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    pub fn from_env() -> anyhow::Result<Self> {
        let link_ids = std::env::var("LINK_IDS")
            .ok()
            .map(|s| {
                s.split(',')
                    .map(|id| id.trim().parse::<uuid::Uuid>())
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()
            .context("LINK_IDS contains invalid UUIDs")?;

        let batch_size = std::env::var("BATCH_SIZE")
            .unwrap_or_else(|_| "10".to_string())
            .parse::<i64>()
            .context("BATCH_SIZE is not a valid number")?;

        let offset = std::env::var("OFFSET")
            .unwrap_or_else(|_| "0".to_string())
            .parse::<i64>()
            .context("OFFSET is not a valid number")?;

        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            link_ids,
            batch_size,
            offset,
        })
    }
}
