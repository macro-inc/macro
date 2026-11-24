use anyhow::Context;
use macro_env_var::{env_vars, maybe_env_vars};
use std::time::Duration;

const DEFAULT_BLOCKS_PER_BATCH: i64 = 50;
const MAX_BLOCKS_PER_BATCH: i64 = 2_000;
const DEFAULT_PAUSE_MS: u64 = 200;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    /// Comma-separated macro IDs to backfill, for a canary: each of their
    /// mailboxes is flagged in one statement. When unset, the whole
    /// `email_attachments` table is walked in batches.
    pub macro_ids: Option<String>,
    pub database_url: String,
    /// Number of users processed concurrently when `MACRO_IDS` is set.
    /// Defaults to 1, capped at 50 to bound DB connection usage.
    pub concurrency: usize,
    /// Block of `email_attachments` to start at; an interrupted pass prints it.
    pub start_block: i64,
    /// Heap blocks of `email_attachments` each batch reads. Defaults to 50.
    pub blocks_per_batch: i64,
    /// Pause between batches, so the run stays in the background. Defaults
    /// to 200 ms.
    pub pause: Duration,
}

env_vars! {
    struct DatabaseUrl;
}

maybe_env_vars! {
    struct MacroIds;
    struct Concurrency;
    struct StartBlock;
    struct BlocksPerBatch;
    struct PauseMs;
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let concurrency = match Concurrency::new() {
            Some(v) => v
                .parse::<usize>()
                .context("CONCURRENCY is not a number")?
                .clamp(1, 50),
            None => 1,
        };
        let start_block = match StartBlock::new() {
            Some(v) => v.parse::<i64>().context("START_BLOCK is not a number")?,
            None => 0,
        };
        anyhow::ensure!(start_block >= 0, "START_BLOCK must not be negative");
        let blocks_per_batch = match BlocksPerBatch::new() {
            Some(v) => v
                .parse::<i64>()
                .context("BLOCKS_PER_BATCH is not a number")?
                .clamp(1, MAX_BLOCKS_PER_BATCH),
            None => DEFAULT_BLOCKS_PER_BATCH,
        };
        let pause = match PauseMs::new() {
            Some(v) => Duration::from_millis(v.parse::<u64>().context("PAUSE_MS is not a number")?),
            None => Duration::from_millis(DEFAULT_PAUSE_MS),
        };

        Ok(Self {
            macro_ids: MacroIds::new().map(|v| v.to_string()),
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            concurrency,
            start_block,
            blocks_per_batch,
            pause,
        })
    }
}
