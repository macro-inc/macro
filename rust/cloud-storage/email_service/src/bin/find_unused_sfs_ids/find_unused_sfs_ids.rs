//! # Find Unused SFS IDs Utility
//!
//! This binary compares UUIDs from the email_sfs_mappings table against a file of used UUIDs
//! to identify which SFS mappings are no longer referenced in email message bodies.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `USED_UUIDS_FILE`: Path to the file containing used UUIDs (default: "used_sfs_uuids.txt").
//! - `ALL_MAPPINGS_FILE`: Path to store all mapping UUIDs (default: "all_sfs_mapping_uuids.txt").
//! - `UNUSED_UUIDS_FILE`: Path to store unused UUIDs (default: "unused_sfs_uuids.txt").
//! - `EXTRACTION_CONCURRENCY`: Concurrency for UUID extraction (default: 100).

mod config;
mod process;

use std::path::Path;
use std::time::Instant;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Find Unused SFS IDs ===\n");

    // Initialize and load configuration
    MacroEntrypoint::default().init();
    let config = load_and_print_config()?;

    // Load used UUIDs into memory for fast lookups
    let used_uuids = load_used_uuids(&config.used_uuids_file)?;

    // Load or fetch all mapping UUIDs
    let all_mappings_path = Path::new(&config.all_mappings_file);
    let total_mappings = load_or_fetch_mappings(&config, all_mappings_path).await?;

    // Find unused UUIDs by streaming comparison
    let unused_count =
        find_and_write_unused_uuids(all_mappings_path, &used_uuids, &config.unused_uuids_file)?;

    // Print summary
    print_summary(
        total_mappings,
        used_uuids.len(),
        unused_count,
        &config.unused_uuids_file,
    );

    Ok(())
}

/// Loads and prints configuration.
fn load_and_print_config() -> anyhow::Result<config::Config> {
    println!("Loading configuration...");
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Configuration:");
    println!("  Used UUIDs file: {}", config.used_uuids_file);
    println!("  All mappings file: {}", config.all_mappings_file);
    println!("  Unused UUIDs file: {}", config.unused_uuids_file);
    println!(
        "  Extraction concurrency: {}\n",
        config.extraction_concurrency
    );

    Ok(config)
}

/// Loads used UUIDs from file into a HashSet for O(1) lookups.
fn load_used_uuids(file_path: &str) -> anyhow::Result<std::collections::HashSet<String>> {
    println!("Loading used UUIDs from {}...", file_path);
    let load_start = Instant::now();
    let used_uuids = process::load_uuids_from_file(Path::new(file_path))?;
    println!(
        "Loaded {} used UUIDs in {:.2?}\n",
        used_uuids.len(),
        load_start.elapsed()
    );
    Ok(used_uuids)
}

/// Loads mapping UUIDs from cache or fetches from database if needed.
async fn load_or_fetch_mappings(
    config: &config::Config,
    all_mappings_path: &Path,
) -> anyhow::Result<usize> {
    if all_mappings_path.exists() {
        load_cached_mappings(all_mappings_path, &config.all_mappings_file)
    } else {
        fetch_mappings_from_database(config, all_mappings_path).await
    }
}

/// Loads mapping count from cached file.
fn load_cached_mappings(path: &Path, file_name: &str) -> anyhow::Result<usize> {
    println!(
        "All mappings file already exists at {}, using cached data...",
        file_name
    );
    let count_start = Instant::now();
    let count = process::count_lines_in_file(path)?;
    println!(
        "Counted {} UUIDs in file in {:.2?}\n",
        count,
        count_start.elapsed()
    );
    Ok(count)
}

/// Fetches mappings from database and writes to file.
async fn fetch_mappings_from_database(
    config: &config::Config,
    output_path: &Path,
) -> anyhow::Result<usize> {
    println!("Connecting to the database...");
    let db_pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .context("Failed to connect to database")?;

    println!(
        "Streaming mapping destinations from email_sfs_mappings to {}...",
        config.all_mappings_file
    );
    let stream_start = Instant::now();
    let count = process::stream_mapping_uuids_to_file(&db_pool, output_path).await?;
    println!(
        "Streamed and wrote {} UUIDs in {:.2?}\n",
        count,
        stream_start.elapsed()
    );
    Ok(count)
}

/// Finds unused UUIDs by streaming comparison and writes to file.
fn find_and_write_unused_uuids(
    all_mappings_path: &Path,
    used_uuids: &std::collections::HashSet<String>,
    output_file: &str,
) -> anyhow::Result<usize> {
    println!(
        "Streaming through {} to find unused UUIDs...",
        all_mappings_path.display()
    );
    let stream_start = Instant::now();
    let unused_count =
        process::stream_find_unused_uuids(all_mappings_path, used_uuids, Path::new(output_file))?;
    println!(
        "Found {} unused UUIDs in {:.2?}\n",
        unused_count,
        stream_start.elapsed()
    );
    Ok(unused_count)
}

/// Prints the final summary.
fn print_summary(total_mappings: usize, used_count: usize, unused_count: usize, output_file: &str) {
    println!("\n=== Summary ===");
    println!("Total mappings: {}", total_mappings);
    println!("Total used UUIDs (from file): {}", used_count);
    println!("Total unused UUIDs: {}", unused_count);
    if total_mappings > 0 {
        println!(
            "Percentage unused: {:.2}%",
            (unused_count as f64 / total_mappings as f64) * 100.0
        );
    } else {
        println!("Percentage unused: N/A (no mappings)");
    }
    println!("\nResults saved to: {}", output_file);
}
