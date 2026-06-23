//! Configuration for the cleanup_unused_sfs binary.

use anyhow::Context;
use macro_env_var::{env_vars, maybe_env_vars};

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

env_vars! {
    struct DatabaseUrl;
    struct SfsUrl;
    struct InternalAuthKey;
    struct DestinationUrlPrefix;
}

maybe_env_vars! {
    struct BulkBatchSize;
    struct BulkConcurrency;
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
        let bulk_batch_size = parse_optional_env(
            BulkBatchSize::new(),
            50usize,
            "BULK_BATCH_SIZE is not a valid number",
        )?;

        let bulk_concurrency = parse_optional_env(
            BulkConcurrency::new(),
            5usize,
            "BULK_CONCURRENCY is not a valid number",
        )?;

        Ok(Self {
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            sfs_url: SfsUrl::new().context("SFS_URL not set")?.to_string(),
            internal_auth_key: InternalAuthKey::new()
                .context("INTERNAL_AUTH_KEY not set")?
                .to_string(),
            unused_uuids_file: UnusedUuidsFile::new()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unused_sfs_uuids.txt".to_string()),
            destination_url_prefix: DestinationUrlPrefix::new()
                .context("DESTINATION_URL_PREFIX not set")?
                .to_string(),
            bulk_batch_size,
            bulk_concurrency,
        })
    }
}
