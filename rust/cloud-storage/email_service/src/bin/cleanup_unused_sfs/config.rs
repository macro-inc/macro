//! Configuration for the cleanup_unused_sfs binary.

use anyhow::Context;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    /// Database connection URL.
    pub database_url: String,
    /// URL for the Static File Service.
    pub sfs_url: String,
    /// Internal auth key for SFS.
    pub internal_auth_key: String,
    /// Path to the file containing unused UUIDs.
    pub unused_uuids_file: String,
    /// URL prefix to reconstruct full destination URLs (e.g., "https://static-file-service-dev.macro.com/file/").
    pub destination_url_prefix: String,
    /// Number of files to include in each bulk delete request.
    pub bulk_batch_size: usize,
    /// Number of concurrent bulk delete requests.
    pub bulk_concurrency: usize,
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let bulk_batch_size = std::env::var("BULK_BATCH_SIZE")
            .unwrap_or_else(|_| "50".to_string())
            .parse::<usize>()
            .context("BULK_BATCH_SIZE is not a valid number")?;

        let bulk_concurrency = std::env::var("BULK_CONCURRENCY")
            .unwrap_or_else(|_| "5".to_string())
            .parse::<usize>()
            .context("BULK_CONCURRENCY is not a valid number")?;

        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            sfs_url: std::env::var("SFS_URL").context("SFS_URL not set")?,
            internal_auth_key: std::env::var("INTERNAL_AUTH_KEY")
                .context("INTERNAL_AUTH_KEY not set")?,
            unused_uuids_file: std::env::var("UNUSED_UUIDS_FILE")
                .unwrap_or_else(|_| "unused_sfs_uuids.txt".to_string()),
            destination_url_prefix: std::env::var("DESTINATION_URL_PREFIX")
                .context("DESTINATION_URL_PREFIX not set")?,
            bulk_batch_size,
            bulk_concurrency,
        })
    }
}
