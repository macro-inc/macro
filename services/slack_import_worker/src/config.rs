//! Environment-backed startup configuration. Queue/URL overrides use shared types.

use database_env_vars::DatabaseUrl;
use slack_integration::{domain::models::ImportError, inbound::worker::WorkerConfig};

#[cfg(test)]
mod test;

/// Settings supplied by the deployment, never by an import archive.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// MacroDB connection URL.
    pub database_url: DatabaseUrl,
    /// Immutable temporary archive object bucket.
    pub upload_staging_bucket: String,
    /// Credential for scoped search backfill requests.
    pub internal_api_key: String,
    /// Pause new claims and outbox sends, not reconciliation or queues.
    #[macro_config_default(false)]
    pub slack_import_enabled: bool,
    /// Initially one; fail startup above two rather than silently widening work.
    #[macro_config_default(1)]
    pub slack_import_concurrency: u8,
}

impl Config {
    /// Fail fast before polling queues.
    pub fn worker(&self) -> Result<WorkerConfig, ImportError> {
        WorkerConfig::new(self.slack_import_enabled, self.slack_import_concurrency, 5)
    }
}
