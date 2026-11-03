//! # Outlook Reply Snippet Backfill
//!
//! Recomputes `email_messages.snippet` for Outlook messages from their stored
//! bodies, using the reply extraction Outlook ingest now uses. Messages
//! ingested before that change kept Graph's `bodyPreview`, which starts with
//! the quoted message being replied to, and ingest skips them while their
//! ETag is unchanged. Messages with no body keep their snippet, as ingest
//! does. A rerun changes nothing.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `LINK_IDS`: Comma-separated link IDs to backfill. Only Outlook links
//!   among them are processed. When unset, every Outlook link is processed.
//! - `CONCURRENCY`: Number of links processed concurrently (defaults to 1,
//!   capped at 50).
//! - `VERIFY`: When `true`, read-only mode — reports messages whose snippet
//!   would change and exits non-zero if any are found.

mod config;
mod process;

use macro_entrypoint::MacroEntrypoint;
use rootcause::prelude::{Report, ResultExt as _};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), Report> {
    let config = config::Config::from_env()?;
    let db_pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(config.concurrency as u32)
        .connect(&config.database_url)
        .await
        .context("could not connect to the database")?;

    let mode = config.mode;
    let results = process::backfill(&db_pool, config.link_ids, config.concurrency, mode).await?;

    let total: u64 = results.iter().filter_map(|(_, r)| r.as_ref().ok()).sum();
    let failures: Vec<String> = results
        .iter()
        .filter(|(_, r)| r.is_err())
        .map(|(id, _)| id.to_string())
        .collect();

    tracing::info!(
        ?mode,
        snippets = total,
        failures = failures.len(),
        "all links processed"
    );
    if !failures.is_empty() {
        rootcause::bail!(
            "{} links failed ({}); rerun with LINK_IDS to retry them",
            failures.len(),
            failures.join(", ")
        );
    }
    if mode == config::Mode::Verify && total > 0 {
        rootcause::bail!("{total} Outlook snippets are stale; run without VERIFY to repair");
    }
    Ok(())
}
