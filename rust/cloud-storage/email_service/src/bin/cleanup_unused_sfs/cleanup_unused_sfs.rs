//! # Cleanup Unused SFS Files Utility
//!
//! This binary deletes unused SFS files and their corresponding database mappings.
//! It reads UUIDs from a file, deletes each file from SFS, then removes the mapping
//! from the email_sfs_mappings table.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//! - `SFS_URL`: The URL for the Static File Service.
//! - `INTERNAL_AUTH_KEY`: Internal auth key for SFS authentication.
//! - `DESTINATION_URL_PREFIX`: URL prefix for reconstructing destination URLs
//!   (e.g., "https://static-file-service-dev.macro.com/file/").
//!
//! ## Optional Environment Variables:
//! - `UNUSED_UUIDS_FILE`: Path to the file containing unused UUIDs (default: "unused_sfs_uuids.txt").
//! - `CONCURRENCY`: Number of concurrent delete operations (default: 10).

mod config;
mod process;

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use anyhow::Context;
use futures::stream::{StreamExt as FuturesStreamExt, TryStreamExt};
use macro_entrypoint::MacroEntrypoint;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Statistics for tracking deletion operations.
struct DeletionStats {
    sfs_deleted: Arc<AtomicUsize>,
    sfs_already_deleted: Arc<AtomicUsize>,
    sfs_failed: Arc<AtomicUsize>,
    db_success: Arc<AtomicUsize>,
    db_failed: Arc<AtomicUsize>,
    processed: Arc<AtomicUsize>,
}

/// Context for deletion operations.
struct DeletionContext<'a> {
    uuids_file: &'a str,
    sfs_client: &'a static_file_service_client::StaticFileServiceClient,
    db_pool: &'a PgPool,
    destination_prefix: &'a str,
    bulk_batch_size: usize,
    bulk_concurrency: usize,
    stats: &'a DeletionStats,
    total: usize,
}

impl DeletionStats {
    fn new() -> Self {
        Self {
            sfs_deleted: Arc::new(AtomicUsize::new(0)),
            sfs_already_deleted: Arc::new(AtomicUsize::new(0)),
            sfs_failed: Arc::new(AtomicUsize::new(0)),
            db_success: Arc::new(AtomicUsize::new(0)),
            db_failed: Arc::new(AtomicUsize::new(0)),
            processed: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn print_summary(&self, total: usize, duration: std::time::Duration) {
        println!("\n=== Summary ===");
        println!("Total UUIDs processed: {}", total);
        println!(
            "SFS deletions: {} deleted, {} already deleted, {} failed",
            self.sfs_deleted.load(Ordering::Relaxed),
            self.sfs_already_deleted.load(Ordering::Relaxed),
            self.sfs_failed.load(Ordering::Relaxed)
        );
        println!(
            "DB deletions: {} succeeded, {} failed",
            self.db_success.load(Ordering::Relaxed),
            self.db_failed.load(Ordering::Relaxed)
        );
        println!("Total time: {:.2?}", duration);
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Cleanup Unused SFS Files ===\n");

    // Initialize and load configuration
    MacroEntrypoint::default().init();
    let config = load_and_print_config()?;

    // Count UUIDs to delete
    let total = count_uuids_to_delete(&config.unused_uuids_file)?;
    if total == 0 {
        println!("No UUIDs to delete. Exiting.");
        return Ok(());
    }

    // Setup database and SFS client
    let db_pool = connect_to_database(&config).await?;
    let sfs_client = create_sfs_client(&config);

    // Execute deletions
    let stats = DeletionStats::new();
    let delete_start = Instant::now();

    let ctx = DeletionContext {
        uuids_file: &config.unused_uuids_file,
        sfs_client: &sfs_client,
        db_pool: &db_pool,
        destination_prefix: &config.destination_url_prefix,
        bulk_batch_size: config.bulk_batch_size,
        bulk_concurrency: config.bulk_concurrency,
        stats: &stats,
        total,
    };

    execute_deletions(ctx).await?;

    // Print summary
    stats.print_summary(total, delete_start.elapsed());

    Ok(())
}

/// Loads and prints configuration.
fn load_and_print_config() -> anyhow::Result<config::Config> {
    println!("Loading configuration...");
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Configuration:");
    println!("  SFS URL: {}", config.sfs_url);
    println!("  Unused UUIDs file: {}", config.unused_uuids_file);
    println!(
        "  Destination URL prefix: {}",
        config.destination_url_prefix
    );
    println!("  Bulk batch size: {}", config.bulk_batch_size);
    println!("  Bulk concurrency: {}\n", config.bulk_concurrency);

    Ok(config)
}

/// Counts UUIDs in the input file.
fn count_uuids_to_delete(file_path: &str) -> anyhow::Result<usize> {
    println!("Counting UUIDs in {}...", file_path);
    let count_start = Instant::now();
    let total = process::count_uuids_in_file(Path::new(file_path))?;
    println!(
        "Found {} UUIDs to delete in {:.2?}\n",
        total,
        count_start.elapsed()
    );
    Ok(total)
}

/// Connects to the database.
async fn connect_to_database(config: &config::Config) -> anyhow::Result<PgPool> {
    println!("Connecting to the database...");
    PgPoolOptions::new()
        .min_connections(5)
        .max_connections(config.bulk_concurrency as u32 + 5)
        .connect(&config.database_url)
        .await
        .context("Failed to connect to database")
}

/// Creates the SFS client.
fn create_sfs_client(
    config: &config::Config,
) -> static_file_service_client::StaticFileServiceClient {
    static_file_service_client::StaticFileServiceClient::new(
        config.internal_auth_key.clone(),
        config.sfs_url.clone(),
    )
}

/// Executes all deletions using bulk delete endpoint.
async fn execute_deletions(ctx: DeletionContext<'_>) -> anyhow::Result<()> {
    println!(
        "Deleting {} files with bulk batch size {} and concurrency {}...\n",
        ctx.total, ctx.bulk_batch_size, ctx.bulk_concurrency
    );

    // Collect UUIDs into batches
    let uuid_stream = process::stream_uuids_from_file(Path::new(ctx.uuids_file))?;

    // Batch the UUIDs and process them concurrently
    uuid_stream
        .try_chunks(ctx.bulk_batch_size)
        .map(|result| async {
            match result {
                Ok(uuids) if !uuids.is_empty() => {
                    process_bulk_batch(
                        uuids,
                        ctx.sfs_client,
                        ctx.db_pool,
                        ctx.destination_prefix,
                        ctx.stats,
                        ctx.total,
                    )
                    .await;
                }
                Ok(_) => {} // Empty batch
                Err(e) => {
                    eprintln!("Error reading UUIDs from file: {:?}", e.1);
                }
            }
        })
        .buffer_unordered(ctx.bulk_concurrency)
        .collect::<Vec<_>>()
        .await;

    Ok(())
}

/// Processes a bulk batch of UUIDs.
async fn process_bulk_batch(
    uuids: Vec<String>,
    sfs_client: &static_file_service_client::StaticFileServiceClient,
    db_pool: &PgPool,
    destination_prefix: &str,
    stats: &DeletionStats,
    total: usize,
) {
    let batch_size = uuids.len();

    // Call bulk delete endpoint
    match sfs_client.bulk_delete_files(uuids.clone()).await {
        Ok(response) => {
            // Process SFS results
            for result in &response.results {
                if result.success {
                    stats.sfs_deleted.fetch_add(1, Ordering::Relaxed);
                } else if let Some(error) = &result.error {
                    if error.contains("not found") || error.contains("404") {
                        stats.sfs_already_deleted.fetch_add(1, Ordering::Relaxed);
                    } else {
                        eprintln!("Failed to delete {} from SFS: {}", result.file_id, error);
                        stats.sfs_failed.fetch_add(1, Ordering::Relaxed);
                    }
                } else {
                    stats.sfs_failed.fetch_add(1, Ordering::Relaxed);
                }
            }

            // Delete from PostgreSQL database for files that succeeded in SFS
            // Note: The SFS bulk delete endpoint handles its own DynamoDB metadata,
            // but we need to clean up the email_sfs_mappings table in PostgreSQL
            let successful_destination_urls: Vec<String> = response
                .results
                .iter()
                .filter(|r| r.success)
                .map(|r| format!("{}{}", destination_prefix, r.file_id))
                .collect();

            if !successful_destination_urls.is_empty() {
                match process::bulk_delete_mappings_from_db(db_pool, &successful_destination_urls)
                    .await
                {
                    Ok(deleted_count) => {
                        stats
                            .db_success
                            .fetch_add(deleted_count as usize, Ordering::Relaxed);
                        // If some rows weren't found, count them as failures
                        let expected_count = successful_destination_urls.len();
                        if deleted_count < expected_count as u64 {
                            let failed_count = expected_count - deleted_count as usize;
                            stats.db_failed.fetch_add(failed_count, Ordering::Relaxed);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to bulk delete mappings: {:?}", e);
                        stats
                            .db_failed
                            .fetch_add(successful_destination_urls.len(), Ordering::Relaxed);
                    }
                }
            }
        }
        Err(e) => {
            tracing::error!(error = ?e, "bulk delete request failed");
            eprintln!("Bulk delete request failed: {:?}", e);

            // Fall back to individual deletions for this batch
            for uuid in uuids {
                delete_single_file_fallback(uuid, sfs_client, db_pool, destination_prefix, stats)
                    .await;
            }
        }
    }

    // Update progress
    let count = stats.processed.fetch_add(batch_size, Ordering::Relaxed) + batch_size;
    if count.is_multiple_of(100) || count >= total {
        print_progress(count, total, stats);
    }
}

/// Fallback to single file deletion if bulk delete fails.
async fn delete_single_file_fallback(
    uuid: String,
    sfs_client: &static_file_service_client::StaticFileServiceClient,
    db_pool: &PgPool,
    destination_prefix: &str,
    stats: &DeletionStats,
) {
    // Delete from SFS using the old single delete endpoint
    match process::delete_from_sfs(sfs_client, &uuid).await {
        process::SfsDeleteResult::Deleted => {
            stats.sfs_deleted.fetch_add(1, Ordering::Relaxed);
        }
        process::SfsDeleteResult::AlreadyDeleted => {
            stats.sfs_already_deleted.fetch_add(1, Ordering::Relaxed);
        }
        process::SfsDeleteResult::Error(e) => {
            eprintln!("Failed to delete {} from SFS: {:?}", uuid, e);
            stats.sfs_failed.fetch_add(1, Ordering::Relaxed);
            return; // Don't try to delete from DB if SFS failed
        }
    }

    // Delete from database
    let destination_url = format!("{}{}", destination_prefix, uuid);
    match process::delete_mapping_from_db(db_pool, &destination_url).await {
        Ok(_) => {
            stats.db_success.fetch_add(1, Ordering::Relaxed);
        }
        Err(e) => {
            eprintln!("Failed to delete mapping for {}: {:?}", uuid, e);
            stats.db_failed.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Prints progress update.
fn print_progress(count: usize, total: usize, stats: &DeletionStats) {
    println!(
        "Progress: {}/{} processed (SFS: {} deleted, {} already deleted, {} failed)",
        count,
        total,
        stats.sfs_deleted.load(Ordering::Relaxed),
        stats.sfs_already_deleted.load(Ordering::Relaxed),
        stats.sfs_failed.load(Ordering::Relaxed)
    );
}
