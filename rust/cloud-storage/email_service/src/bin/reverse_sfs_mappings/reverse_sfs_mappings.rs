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
//! - `BATCH_SIZE`: Number of messages to process per batch (default: 10).
//! - `OFFSET`: Starting offset for pagination, useful for pause/resume (default: 0).

mod config;
mod process;

use std::time::Instant;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Reverse SFS Mappings ===\n");

    // Initialize and load configuration
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

    // Connect to database
    println!("Connecting to the database...");
    let db_pool = PgPoolOptions::new()
        .min_connections(2)
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("Failed to connect to database")?;
    println!("Connected.\n");

    // Debug: print counts to diagnose empty results
    process::print_debug_info(&db_pool, &config.link_ids).await?;

    // Process messages in batches
    let start = Instant::now();
    let mut total_messages_scanned: usize = 0;
    let mut total_messages_updated: usize = 0;
    let mut total_urls_reversed: usize = 0;
    let mut total_urls_not_found: usize = 0;
    let mut current_offset = config.offset;

    // Fetch the first batch
    println!(
        "Fetching batch at offset {} (limit {})...",
        current_offset, config.batch_size
    );
    let mut current_batch = process::fetch_messages_batch(
        &db_pool,
        &config.link_ids,
        current_offset,
        config.batch_size,
    )
    .await?;

    loop {
        if current_batch.is_empty() {
            println!("No more messages to process.");
            break;
        }

        let batch_len = current_batch.len();
        let is_last_batch = (batch_len as i64) < config.batch_size;
        let next_offset = current_offset + batch_len as i64;

        total_messages_scanned += batch_len;
        println!(
            "Processing {} messages at offset {} (total scanned so far: {})",
            batch_len, current_offset, total_messages_scanned
        );

        // Start prefetching the next batch immediately (unless this is the last batch)
        let next_batch_fut = if !is_last_batch {
            println!("  Prefetching next batch at offset {} ...", next_offset);
            Some(process::fetch_messages_batch(
                &db_pool,
                &config.link_ids,
                next_offset,
                config.batch_size,
            ))
        } else {
            None
        };

        // Process the current batch while next batch is being fetched
        // Collect all SFS URLs across all messages in this batch
        let mut all_sfs_urls: Vec<String> = Vec::new();
        let mut messages_with_urls: Vec<(usize, &process::MessageRow, Vec<String>)> = Vec::new();

        for (i, msg) in current_batch.iter().enumerate() {
            let html = match &msg.body_html_sanitized {
                Some(h) => h,
                None => continue,
            };

            let sfs_urls = process::extract_sfs_urls(html);
            if sfs_urls.is_empty() {
                continue;
            }

            println!("  Message {}: found {} SFS URL(s)", msg.id, sfs_urls.len());

            all_sfs_urls.extend(sfs_urls.clone());
            messages_with_urls.push((i, msg, sfs_urls));
        }

        // Bulk lookup all SFS URLs for this batch in one query
        let mappings = process::lookup_source_urls_bulk(&db_pool, &all_sfs_urls).await?;
        if !all_sfs_urls.is_empty() {
            println!(
                "  Looked up {} SFS URLs, found {} mappings",
                all_sfs_urls.len(),
                mappings.len()
            );
        }

        // Apply string replacements concurrently across messages using spawn_blocking
        let mapping_map_owned: std::collections::HashMap<String, String> = mappings
            .iter()
            .map(|m| (m.destination.clone(), m.source.clone()))
            .collect();

        // Collect owned data for the blocking task
        let replace_inputs: Vec<(uuid::Uuid, String, Vec<String>)> = messages_with_urls
            .into_iter()
            .map(|(_i, msg, sfs_urls)| (msg.id, msg.body_html_sanitized.clone().unwrap(), sfs_urls))
            .collect();

        let replace_results = tokio::task::spawn_blocking(move || {
            replace_inputs
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

        // Bulk update all modified messages in one query
        if !replace_results.is_empty() {
            let mut update_ids: Vec<uuid::Uuid> = Vec::with_capacity(replace_results.len());
            let mut update_htmls: Vec<String> = Vec::with_capacity(replace_results.len());

            for (id, new_html, urls_reversed, urls_not_found) in &replace_results {
                update_ids.push(*id);
                update_htmls.push(new_html.clone());
                total_urls_reversed += urls_reversed;
                total_urls_not_found += urls_not_found;
            }

            let rows_affected =
                process::bulk_update_message_html(&db_pool, &update_ids, &update_htmls).await?;
            total_messages_updated += rows_affected as usize;
            println!(
                "  Bulk updated {} messages ({} rows affected)",
                replace_results.len(),
                rows_affected
            );
        }

        current_offset = next_offset;

        if is_last_batch {
            break;
        }

        // Await the prefetched next batch
        current_batch = next_batch_fut.unwrap().await?;

        println!(
            "  Batch done. Next offset: {}. Elapsed: {:.2?}\n",
            current_offset,
            start.elapsed()
        );
    }

    let duration = start.elapsed();
    println!("\n=== Summary ===");
    println!("Total messages scanned: {}", total_messages_scanned);
    println!("Total messages updated: {}", total_messages_updated);
    println!("Total URLs reversed: {}", total_urls_reversed);
    println!("Total URLs with no mapping: {}", total_urls_not_found);
    println!("Final offset: {}", current_offset);
    println!("Total time: {:.2?}", duration);

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
