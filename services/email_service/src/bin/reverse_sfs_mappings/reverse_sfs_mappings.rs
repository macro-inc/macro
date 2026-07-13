//! # Reverse SFS Mappings Utility
//!
//! This binary reverses static-file-service URL mappings in email message HTML bodies.
//! It scans `email_messages.body_html_sanitized` for URLs containing "static-file-service",
//! looks up the original source URL in `email_sfs_mappings`, and replaces the SFS URL
//! with the original source URL.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `LINK_IDS`: Comma-separated list of link_id UUIDs to filter messages by.
//!   Each link_id is processed independently.
//! - `BATCH_SIZE`: Number of messages to process per batch (default: 10).
//! - `OFFSET`: Starting offset into the ID list, useful for pause/resume (default: 0).

mod config;
mod process;

use std::time::Instant;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

struct Stats {
    total_messages_scanned: usize,
    total_messages_updated: usize,
    total_urls_reversed: usize,
    total_urls_not_found: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Reverse SFS Mappings ===\n");

    MacroEntrypoint::default().init();
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Configuration:");
    println!("  Batch size: {}", config.batch_size);
    println!("  Starting offset: {}", config.offset);
    if let Some(ref link_ids) = config.link_ids {
        println!("  Filtering by {} link_id(s):", link_ids.len());
        for id in link_ids {
            println!("    - {}", id);
        }
    } else {
        println!("  Processing ALL messages (no link_id filter)");
    }
    println!();

    println!("Connecting to the database...");
    let db_pool = PgPoolOptions::new()
        .min_connections(2)
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("Failed to connect to database")?;
    println!("Connected.\n");

    let start = Instant::now();
    let mut stats = Stats {
        total_messages_scanned: 0,
        total_messages_updated: 0,
        total_urls_reversed: 0,
        total_urls_not_found: 0,
    };

    if let Some(ref link_ids) = config.link_ids {
        let offset = config.offset as usize;

        let grand_total = process::count_messages(&db_pool, &config.link_ids).await? as usize;
        println!("Total messages across all link_ids: {}\n", grand_total);

        for (link_idx, &link_id) in link_ids.iter().enumerate() {
            println!(
                "=== Link {}/{}: {} ===",
                link_idx + 1,
                link_ids.len(),
                link_id,
            );

            // Fetch message IDs for this link_id
            println!("  Fetching message IDs...");
            let ids = process::fetch_message_ids_for_link(&db_pool, link_id).await?;
            println!("  {} messages found", ids.len());

            // Apply offset only to the first link_id
            let skip = if link_idx == 0 { offset } else { 0 };
            if skip > 0 {
                println!("  Skipping first {} messages (OFFSET)", skip);
            }
            let ids_to_process = &ids[skip.min(ids.len())..];

            process_id_batches(
                &db_pool,
                ids_to_process,
                config.batch_size as usize,
                grand_total,
                &mut stats,
                &start,
            )
            .await?;

            println!();
        }
    } else {
        // No link_id filter — fetch all IDs
        println!("Fetching all message IDs...");
        let all_ids = process::fetch_all_message_ids(&db_pool).await?;
        let grand_total = all_ids.len();
        println!("Total messages to process: {}\n", grand_total);

        let offset = config.offset as usize;
        if offset > 0 {
            println!("Skipping first {} messages (OFFSET)\n", offset);
        }
        let ids_to_process = &all_ids[offset.min(grand_total)..];

        process_id_batches(
            &db_pool,
            ids_to_process,
            config.batch_size as usize,
            grand_total,
            &mut stats,
            &start,
        )
        .await?;
    }

    let duration = start.elapsed();
    println!("\n=== Summary ===");
    println!("Total messages scanned: {}", stats.total_messages_scanned);
    println!("Total messages updated: {}", stats.total_messages_updated);
    println!("Total URLs reversed: {}", stats.total_urls_reversed);
    println!("Total URLs with no mapping: {}", stats.total_urls_not_found);
    println!("Total time: {:.2?}", duration);

    Ok(())
}

/// Processes messages in batches by chunking a pre-fetched list of IDs.
/// Prefetches the next batch while processing the current one.
async fn process_id_batches(
    db_pool: &sqlx::PgPool,
    ids: &[uuid::Uuid],
    batch_size: usize,
    grand_total: usize,
    stats: &mut Stats,
    start: &Instant,
) -> anyhow::Result<()> {
    let chunks: Vec<&[uuid::Uuid]> = ids.chunks(batch_size).collect();

    if chunks.is_empty() {
        println!("No messages to process.");
        return Ok(());
    }

    // Prefetch first batch
    let mut current_batch = process::fetch_messages_by_ids(db_pool, chunks[0]).await?;

    for (chunk_idx, _chunk) in chunks.iter().enumerate() {
        if current_batch.is_empty() {
            println!("No messages returned for batch, skipping.");
            continue;
        }

        // Prefetch next batch while processing current
        let next_batch_fut = if chunk_idx + 1 < chunks.len() {
            Some(process::fetch_messages_by_ids(
                db_pool,
                chunks[chunk_idx + 1],
            ))
        } else {
            None
        };

        process_batch(db_pool, &current_batch, stats).await?;

        println!(
            "  {}/{} processed | elapsed {:.2?}",
            stats.total_messages_scanned,
            grand_total,
            start.elapsed()
        );

        if let Some(fut) = next_batch_fut {
            current_batch = fut.await?;
        }
    }

    Ok(())
}

/// Processes a single batch: extract SFS URLs, bulk lookup, replace, bulk update.
async fn process_batch(
    db_pool: &sqlx::PgPool,
    batch: &[process::MessageRow],
    stats: &mut Stats,
) -> anyhow::Result<()> {
    let batch_len = batch.len();
    stats.total_messages_scanned += batch_len;

    // Extract SFS URLs from all messages
    let mut all_sfs_urls: Vec<String> = Vec::new();
    let mut messages_with_urls: Vec<(uuid::Uuid, String, Vec<String>)> = Vec::new();

    for msg in batch {
        let html = match &msg.body_html_sanitized {
            Some(h) => h,
            None => continue,
        };

        let sfs_urls = process::extract_sfs_urls(html);
        if sfs_urls.is_empty() {
            continue;
        }

        all_sfs_urls.extend(sfs_urls.clone());
        messages_with_urls.push((msg.id, html.clone(), sfs_urls));
    }

    if messages_with_urls.is_empty() {
        return Ok(());
    }

    println!(
        "  Found {} messages with {} SFS URLs in batch of {}",
        messages_with_urls.len(),
        all_sfs_urls.len(),
        batch_len
    );

    // Bulk lookup
    let mappings = process::lookup_source_urls_bulk(db_pool, &all_sfs_urls).await?;
    let mapping_map_owned: std::collections::HashMap<String, String> = mappings
        .iter()
        .map(|m| (m.destination.clone(), m.source.clone()))
        .collect();

    // String replacements in blocking task
    let replace_results = tokio::task::spawn_blocking(move || {
        messages_with_urls
            .into_iter()
            .filter_map(|(id, html, sfs_urls)| {
                let mut new_html = html;
                let mut urls_reversed = 0usize;
                let mut urls_not_found = 0usize;

                for sfs_url in &sfs_urls {
                    if let Some(source_url) = mapping_map_owned.get(sfs_url.as_str()) {
                        println!(
                            "    Reversing [{}]: {} -> {}",
                            id,
                            truncate_url(sfs_url, 80),
                            truncate_url(source_url, 80)
                        );
                        new_html = new_html.replace(sfs_url, source_url);
                        urls_reversed += 1;
                    } else {
                        println!(
                            "    WARNING [{}]: No mapping found for: {}",
                            id,
                            truncate_url(sfs_url, 100)
                        );
                        urls_not_found += 1;
                    }
                }

                if urls_reversed > 0 {
                    Some((id, new_html, urls_reversed, urls_not_found))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .context("String replacement task panicked")?;

    // Bulk update
    if !replace_results.is_empty() {
        let mut update_ids: Vec<uuid::Uuid> = Vec::with_capacity(replace_results.len());
        let mut update_htmls: Vec<String> = Vec::with_capacity(replace_results.len());

        for (id, new_html, urls_reversed, urls_not_found) in &replace_results {
            update_ids.push(*id);
            update_htmls.push(new_html.clone());
            stats.total_urls_reversed += urls_reversed;
            stats.total_urls_not_found += urls_not_found;
        }

        let rows_affected =
            process::bulk_update_message_html(db_pool, &update_ids, &update_htmls).await?;
        stats.total_messages_updated += rows_affected as usize;
        println!(
            "  Bulk updated {} messages ({} rows affected)",
            replace_results.len(),
            rows_affected
        );
    }

    Ok(())
}

/// Truncates a URL for display purposes.
fn truncate_url(url: &str, max_len: usize) -> String {
    if url.len() <= max_len {
        url.to_string()
    } else {
        format!("{}...", &url[..max_len])
    }
}
