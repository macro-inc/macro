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

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Loading configuration...");
    MacroEntrypoint::default().init();
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Connecting to the database...");
    let db_pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(config.concurrency as u32)
        .connect(&config.database_url)
        .await
        .context("Could not connect to db")?;

    let mode = config.mode;
    let results = process::backfill(&db_pool, config.link_ids, config.concurrency, mode)
        .await
        .context("Failed to fetch Outlook links")?;

    let total: u64 = results.iter().filter_map(|(_, r)| r.as_ref().ok()).sum();
    let failures: Vec<String> = results
        .iter()
        .filter(|(_, r)| r.is_err())
        .map(|(id, _)| id.to_string())
        .collect();

    println!(
        "\n=== All links processed: {total} snippets {}, {} failures ===",
        mode.noun(),
        failures.len()
    );
    if !failures.is_empty() {
        anyhow::bail!(
            "{} links failed ({}); rerun with LINK_IDS to retry them",
            failures.len(),
            failures.join(", ")
        );
    }
    if mode == config::Mode::Verify && total > 0 {
        anyhow::bail!("{total} Outlook snippets are stale; run without VERIFY to repair");
    }
    Ok(())
}
