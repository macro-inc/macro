//! Configuration for the find_unused_sfs_ids binary.

use anyhow::Context;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    /// Database connection URL.
    pub database_url: String,
    /// Path to the file containing used SFS UUIDs.
    pub used_uuids_file: String,
    /// Path to the file storing all mapping UUIDs from the database.
    pub all_mappings_file: String,
    /// Path to the file storing unused SFS UUIDs.
    pub unused_uuids_file: String,
    /// Concurrency for UUID extraction from URLs.
    pub extraction_concurrency: usize,
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let extraction_concurrency = std::env::var("EXTRACTION_CONCURRENCY")
            .unwrap_or_else(|_| "100".to_string())
            .parse::<usize>()
            .context("EXTRACTION_CONCURRENCY is not a valid number")?;

        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            used_uuids_file: std::env::var("USED_UUIDS_FILE")
                .unwrap_or_else(|_| "used_sfs_uuids.txt".to_string()),
            all_mappings_file: std::env::var("ALL_MAPPINGS_FILE")
                .unwrap_or_else(|_| "all_sfs_mapping_uuids.txt".to_string()),
            unused_uuids_file: std::env::var("UNUSED_UUIDS_FILE")
                .unwrap_or_else(|_| "unused_sfs_uuids.txt".to_string()),
            extraction_concurrency,
        })
    }
}
