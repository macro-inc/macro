//! Configuration for the find_unused_sfs_ids binary.

use anyhow::Context;
use macro_env_var::{env_vars, maybe_env_vars};

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

env_vars! {
    struct DatabaseUrl;
}

maybe_env_vars! {
    struct ExtractionConcurrency;
    struct UsedUuidsFile;
    struct AllMappingsFile;
    struct UnusedUuidsFile;
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
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let extraction_concurrency = parse_optional_env(
            ExtractionConcurrency::new(),
            100usize,
            "EXTRACTION_CONCURRENCY is not a valid number",
        )?;

        Ok(Self {
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            used_uuids_file: UsedUuidsFile::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "used_sfs_uuids.txt".to_string()),
            all_mappings_file: AllMappingsFile::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "all_sfs_mapping_uuids.txt".to_string()),
            unused_uuids_file: UnusedUuidsFile::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unused_sfs_uuids.txt".to_string()),
            extraction_concurrency,
        })
    }
}
