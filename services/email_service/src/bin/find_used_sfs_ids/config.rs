//! Configuration for the find_used_sfs_ids binary.

use anyhow::Context;
use macro_env_var::{env_vars, maybe_env_vars};

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

env_vars! {
    struct DatabaseUrl;
}

maybe_env_vars! {
    struct FetchBatchSize;
    struct BatchSize;
    struct PrefetchBatches;
    struct SfsDomain;
    struct MessageIdsFile;
    struct UsedUuidsFile;
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
        let fetch_batch_size = parse_optional_env(
            FetchBatchSize::new(),
            1000usize,
            "FETCH_BATCH_SIZE is not a valid number",
        )?;

        let batch_size = parse_optional_env(
            BatchSize::new(),
            1000usize,
            "BATCH_SIZE is not a valid number",
        )?;

        let prefetch_batches = parse_optional_env(
            PrefetchBatches::new(),
            2usize,
            "PREFETCH_BATCHES is not a valid number",
        )?;

        Ok(Self {
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            sfs_domain: SfsDomain::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "static-file-service.macro.com".to_string()),
            message_ids_file: MessageIdsFile::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "message_ids.txt".to_string()),
            used_uuids_file: UsedUuidsFile::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "used_sfs_uuids.txt".to_string()),
            fetch_batch_size,
            batch_size,
            prefetch_batches,
        })
    }
}
