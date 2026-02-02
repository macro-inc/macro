//! Configuration for the find_used_sfs_ids binary.

use anyhow::Context;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    /// Database connection URL.
    pub database_url: String,
    /// The domain to search for in HTML content (e.g., "static-file-service.macro.com").
    pub sfs_domain: String,
    /// Path to the file storing message IDs.
    pub message_ids_file: String,
    /// Path to the file storing used SFS UUIDs.
    pub used_uuids_file: String,
    /// Batch size for fetching message bodies from the database.
    pub fetch_batch_size: usize,
    /// Batch size for progress logging.
    pub batch_size: usize,
    /// Number of batches to prefetch (buffer size for the fetch-process pipeline).
    pub prefetch_batches: usize,
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let fetch_batch_size = std::env::var("FETCH_BATCH_SIZE")
            .unwrap_or_else(|_| "1000".to_string())
            .parse::<usize>()
            .context("FETCH_BATCH_SIZE is not a valid number")?;

        let batch_size = std::env::var("BATCH_SIZE")
            .unwrap_or_else(|_| "1000".to_string())
            .parse::<usize>()
            .context("BATCH_SIZE is not a valid number")?;

        let prefetch_batches = std::env::var("PREFETCH_BATCHES")
            .unwrap_or_else(|_| "2".to_string())
            .parse::<usize>()
            .context("PREFETCH_BATCHES is not a valid number")?;

        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            sfs_domain: std::env::var("SFS_DOMAIN")
                .unwrap_or_else(|_| "static-file-service.macro.com".to_string()),
            message_ids_file: std::env::var("MESSAGE_IDS_FILE")
                .unwrap_or_else(|_| "message_ids.txt".to_string()),
            used_uuids_file: std::env::var("USED_UUIDS_FILE")
                .unwrap_or_else(|_| "used_sfs_uuids.txt".to_string()),
            fetch_batch_size,
            batch_size,
            prefetch_batches,
        })
    }
}
