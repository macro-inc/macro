//! # Signal Flag Backfill Utility
//!
//! Backfills the denormalized `email_threads.is_signal` column: for each
//! user, flags every thread that has at least one non-TRASH message matching
//! the importance heuristic (email_filters sender overrides, category
//! labels, drafts). By default only ever sets the flag to true — steady-state
//! maintenance (including clearing it) is handled by update_thread_metadata
//! in `email_db_client` and the `email` crate. Set `FULL_RECOMPUTE=true` to
//! also clear stale true flags (full bidirectional recompute per link).
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `MACRO_IDS`: Comma-separated macro IDs to backfill. When unset, every
//!   user with an email link is processed.
//! - `CONCURRENCY`: Number of users processed concurrently (defaults to 1).
//! - `FULL_RECOMPUTE`: When `true`, recomputes both directions instead of
//!   the default set-true-only pass (defaults to false).
//! - `VERIFY`: When `true`, read-only mode — reports threads whose is_signal
//!   disagrees with the heuristic and exits non-zero if any are found.
//!   Mutually exclusive with `FULL_RECOMPUTE`.

mod config;
mod process;

use anyhow::Context;
use futures::stream::{self, StreamExt};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

/// What the per-link count means in log lines, per mode.
fn mode_noun(mode: config::BackfillMode) -> &'static str {
    match mode {
        config::BackfillMode::SetTrueOnly => "flagged",
        // FullRecompute clears first: the count is threads that ended true.
        config::BackfillMode::FullRecompute => "computed as signal",
        config::BackfillMode::Verify => "mismatched",
    }
}

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

    let macro_ids: Vec<String> = match &config.macro_ids {
        Some(ids) => ids.split(',').map(|id| id.trim().to_string()).collect(),
        None => process::fetch_all_macro_ids(&db_pool)
            .await
            .context("Failed to fetch macro IDs")?,
    };

    let total_users = macro_ids.len();
    println!(
        "Processing {total_users} macro IDs with concurrency {}",
        config.concurrency
    );

    let mode = config.mode;
    let results: Vec<(String, anyhow::Result<u64>)> = stream::iter(macro_ids)
        .map(|macro_id| {
            let db_pool = db_pool.clone();
            async move {
                let result = process::process_macro_id(&db_pool, &macro_id, mode).await;
                (macro_id, result)
            }
        })
        .buffer_unordered(config.concurrency)
        .enumerate()
        .map(|(index, (macro_id, result))| {
            match &result {
                Ok(count) => println!(
                    "=== Completed {macro_id} ({}/{total_users}): {count} threads {} ===",
                    index + 1,
                    mode_noun(mode)
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

    let total: u64 = results.iter().filter_map(|(_, r)| r.as_ref().ok()).sum();
    let failures: Vec<&String> = results
        .iter()
        .filter(|(_, r)| r.is_err())
        .map(|(id, _)| id)
        .collect();

    println!(
        "\n=== All macro IDs processed: {total} threads {}, {} failures ===",
        mode_noun(mode),
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
    if mode == config::BackfillMode::Verify && total > 0 {
        anyhow::bail!(
            "{total} threads disagree with the heuristic; run with FULL_RECOMPUTE=true to repair"
        );
    }
    Ok(())
}
