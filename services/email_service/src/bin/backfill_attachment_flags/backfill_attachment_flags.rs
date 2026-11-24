//! # Attachment Kind Flag Backfill Utility
//!
//! Backfills the denormalized `email_threads.has_pdf_attachment`,
//! `has_image_attachment` and `has_document_attachment` columns behind the
//! Attachment email filter. Only ever sets flags to true; steady-state
//! maintenance (including clearing them on deletes) is handled by the ingest
//! and delete paths in `email_db_client`. Safe to rerun.
//!
//! Without `MACRO_IDS` it walks `email_attachments` in heap order, one short
//! transaction per batch, so the whole table is read once and a thread is
//! never locked for longer than a batch. A batch that hits the statement
//! timeout runs again as two halves. The progress lines name the block to
//! resume at; a thread another transaction holds is skipped and counted, so a
//! second run picks it up. With `MACRO_IDS` it flags the named users'
//! mailboxes one statement each, to check a run on a small mailbox first; it
//! is cancelled after five minutes and is not for a large one.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `MACRO_IDS`: Comma-separated macro IDs to backfill, instead of the table.
//! - `CONCURRENCY`: Number of users processed concurrently with `MACRO_IDS`
//!   (defaults to 1).
//! - `START_BLOCK`: Block of `email_attachments` to resume at (defaults to 0).
//! - `BLOCKS_PER_BATCH`: Blocks each batch reads (defaults to 50, at most
//!   2000).
//! - `PAUSE_MS`: Pause between batches in milliseconds (defaults to 200).

mod config;
mod process;

use anyhow::Context;
use futures::stream::{self, StreamExt};
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

    match &config.macro_ids {
        None => process::run_pass(&db_pool, &config).await,
        Some(macro_ids) => flag_mailboxes(&db_pool, macro_ids, config.concurrency).await,
    }
}

async fn flag_mailboxes(
    db_pool: &sqlx::PgPool,
    macro_ids: &str,
    concurrency: usize,
) -> anyhow::Result<()> {
    let macro_ids: Vec<String> = macro_ids
        .split(',')
        .map(|id| id.trim().to_string())
        .collect();
    let total_users = macro_ids.len();
    println!("Processing {total_users} macro IDs with concurrency {concurrency}");

    let results: Vec<(String, anyhow::Result<u64>)> = stream::iter(macro_ids)
        .map(|macro_id| async move {
            let result = process::process_macro_id(db_pool, &macro_id).await;
            (macro_id, result)
        })
        .buffer_unordered(concurrency)
        .enumerate()
        .map(|(index, (macro_id, result))| {
            match &result {
                Ok(flagged) => println!(
                    "=== Completed {macro_id} ({}/{total_users}): flagged {flagged} threads ===",
                    index + 1
                ),
                Err(e) => println!(
                    "=== Failed {macro_id} ({}/{total_users}): {e:?} ===",
                    index + 1
                ),
            }
            (macro_id, result)
        })
        .collect()
        .await;

    let total_flagged: u64 = results.iter().filter_map(|(_, r)| r.as_ref().ok()).sum();
    let failures: Vec<&String> = results
        .iter()
        .filter(|(_, r)| r.is_err())
        .map(|(id, _)| id)
        .collect();

    println!(
        "\n=== All macro IDs processed: {total_flagged} threads flagged, {} failures ===",
        failures.len()
    );
    if !failures.is_empty() {
        anyhow::bail!(
            "{} macro IDs failed ({}); rerun to retry (already-flagged threads are skipped)",
            failures.len(),
            failures
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    Ok(())
}
