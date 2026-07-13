//! # Find Used SFS IDs Utility
//!
//! This binary scans email message HTML content to find all SFS (Static File Service) UUIDs
//! that are referenced in message bodies. This helps identify which SFS mappings are actually
//! in use versus those that are orphaned.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//!
//! ## Optional Environment Variables:
//! - `SFS_DOMAIN`: The domain to search for (default: "static-file-service.macro.com").
//! - `MESSAGE_IDS_FILE`: Path to store/load message IDs (default: "message_ids.txt").
//! - `USED_UUIDS_FILE`: Path to store found UUIDs (default: "used_sfs_uuids.txt").
//! - `FETCH_BATCH_SIZE`: Number of messages to fetch from DB per query (default: 1000).
//! - `BATCH_SIZE`: Number of messages to process before logging progress (default: 1000).
//! - `PREFETCH_BATCHES`: Number of batches to prefetch while processing (default: 2).

mod config;
mod process;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Context;
use futures::future::join_all;
use macro_entrypoint::MacroEntrypoint;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tokio::sync::mpsc;
use uuid::Uuid;

/// A fetched batch of message bodies along with their original IDs.
struct FetchedBatch {
    message_bodies: Vec<process::MessageBody>,
    fetch_duration: std::time::Duration,
}

/// Tracking state for processing progress and results.
struct ProcessingState {
    all_found_uuids: HashSet<Uuid>,
    new_uuids_this_run: HashSet<Uuid>,
    processed_count: usize,
    batches_completed: usize,
}

impl ProcessingState {
    fn new(initial_uuids: HashSet<Uuid>) -> Self {
        Self {
            all_found_uuids: initial_uuids,
            new_uuids_this_run: HashSet::new(),
            processed_count: 0,
            batches_completed: 0,
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Find Used SFS IDs ===\n");

    // Initialize and load configuration
    MacroEntrypoint::default().init();
    let config = load_and_print_config()?;

    // Connect to database
    let db_pool = connect_to_database(&config.database_url).await?;

    // Load or fetch all message IDs
    let message_ids = process::load_or_fetch_message_ids(&db_pool, &config).await?;
    println!("Total message IDs to process: {}\n", message_ids.len());

    // Setup resume functionality and load existing progress
    let (used_uuids_path, processed_file) = setup_file_paths(&config);
    let existing_uuids = load_existing_progress(&used_uuids_path)?;
    let processed_ids = load_resume_state(&processed_file)?;

    // Filter to only unprocessed messages
    let ids_to_process = filter_unprocessed_ids(message_ids, processed_ids);
    if ids_to_process.is_empty() {
        println!("No messages to process. Exiting.");
        return Ok(());
    }

    // Process all messages and extract UUIDs
    let mut state = ProcessingState::new(existing_uuids);
    process_all_messages(
        &db_pool,
        ids_to_process,
        &config,
        &mut state,
        &used_uuids_path,
        &processed_file,
    )
    .await?;

    // Print final summary
    print_summary(&state, &config.used_uuids_file);

    Ok(())
}

/// Loads and prints configuration.
fn load_and_print_config() -> anyhow::Result<config::Config> {
    println!("Loading configuration...");
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Configuration:");
    println!("  SFS Domain: {}", config.sfs_domain);
    println!("  Message IDs file: {}", config.message_ids_file);
    println!("  Used UUIDs file: {}", config.used_uuids_file);
    println!("  Fetch batch size: {}", config.fetch_batch_size);
    println!("  Progress batch size: {}", config.batch_size);
    println!("  Prefetch batches: {}\n", config.prefetch_batches);

    Ok(config)
}

/// Connects to the database.
async fn connect_to_database(database_url: &str) -> anyhow::Result<PgPool> {
    println!("Connecting to the database...");
    PgPoolOptions::new()
        .min_connections(5)
        .max_connections(20)
        .connect(database_url)
        .await
        .context("Failed to connect to database")
}

/// Sets up file paths for output and resume tracking.
fn setup_file_paths(config: &config::Config) -> (PathBuf, PathBuf) {
    let used_uuids_path = PathBuf::from(&config.used_uuids_file);
    let processed_file = Path::new(&config.message_ids_file).with_extension("processed");
    (used_uuids_path, processed_file)
}

/// Loads existing UUIDs from previous runs.
fn load_existing_progress(used_uuids_path: &Path) -> anyhow::Result<HashSet<Uuid>> {
    let existing_uuids = process::load_existing_used_uuids(used_uuids_path)?;
    let initial_count = existing_uuids.len();
    if initial_count > 0 {
        println!(
            "Loaded {} existing UUIDs from {}",
            initial_count,
            used_uuids_path.display()
        );
    }
    Ok(existing_uuids)
}

/// Loads resume state (already processed message IDs).
fn load_resume_state(processed_file: &Path) -> anyhow::Result<HashSet<Uuid>> {
    let processed_ids = process::load_processed_message_ids(processed_file)?;
    let already_processed = processed_ids.len();
    if already_processed > 0 {
        println!("Resuming: {} messages already processed", already_processed);
    }
    Ok(processed_ids)
}

/// Filters out already processed messages.
fn filter_unprocessed_ids(message_ids: Vec<Uuid>, processed_ids: HashSet<Uuid>) -> Vec<Uuid> {
    let ids_to_process: Vec<_> = message_ids
        .into_iter()
        .filter(|id| !processed_ids.contains(id))
        .collect();
    println!("Messages remaining to process: {}\n", ids_to_process.len());
    ids_to_process
}

/// Processes all messages by fetching and extracting UUIDs.
async fn process_all_messages(
    db_pool: &PgPool,
    ids_to_process: Vec<Uuid>,
    config: &config::Config,
    state: &mut ProcessingState,
    used_uuids_path: &Path,
    processed_file: &Path,
) -> anyhow::Result<()> {
    let total_to_process = ids_to_process.len();

    // Create channel for the fetch-process pipeline
    let (tx, mut rx) = mpsc::channel::<FetchedBatch>(config.prefetch_batches);

    // Split IDs into batches and spawn fetcher task
    let batches = create_batches(&ids_to_process, config.fetch_batch_size);
    let total_batches = batches.len();
    let fetcher_handle = spawn_fetcher_task(db_pool.clone(), batches, tx);

    // Process batches as they arrive
    let sfs_domain = Arc::new(config.sfs_domain.clone());

    while let Some(batch) = rx.recv().await {
        process_single_batch(
            batch,
            state,
            &sfs_domain,
            total_batches,
            total_to_process,
            used_uuids_path,
            processed_file,
        )
        .await?;
    }

    // Wait for fetcher to complete
    fetcher_handle.await?;

    // Flush any remaining UUIDs
    if !state.new_uuids_this_run.is_empty() {
        process::append_uuids_to_file(&state.new_uuids_this_run, used_uuids_path)?;
    }

    Ok(())
}

/// Creates batches of message IDs for processing.
fn create_batches(ids: &[Uuid], batch_size: usize) -> Vec<Vec<Uuid>> {
    ids.chunks(batch_size).map(|chunk| chunk.to_vec()).collect()
}

/// Spawns the database fetcher task.
fn spawn_fetcher_task(
    db_pool: PgPool,
    batches: Vec<Vec<Uuid>>,
    tx: mpsc::Sender<FetchedBatch>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        fetch_batches(db_pool, batches, tx).await;
    })
}

/// Processes a single batch of messages.
async fn process_single_batch(
    batch: FetchedBatch,
    state: &mut ProcessingState,
    sfs_domain: &Arc<String>,
    total_batches: usize,
    total_to_process: usize,
    used_uuids_path: &Path,
    processed_file: &Path,
) -> anyhow::Result<()> {
    state.batches_completed += 1;

    println!(
        "  [Batch {}/{}] DB fetch: {} messages in {:.2?}",
        state.batches_completed,
        total_batches,
        batch.message_bodies.len(),
        batch.fetch_duration
    );

    // Extract UUIDs from all messages in the batch
    let process_start = Instant::now();
    let batch_count = batch.message_bodies.len();
    let batch_processed_ids =
        extract_uuids_from_batch(batch.message_bodies, sfs_domain, state).await;

    println!(
        "  [Batch {}/{}] Processing: {} messages in {:.2?}",
        state.batches_completed,
        total_batches,
        batch_count,
        process_start.elapsed()
    );

    // Mark batch as processed
    if let Err(e) = process::append_uuids_to_file(
        &batch_processed_ids.iter().cloned().collect(),
        processed_file,
    ) {
        eprintln!("Warning: Failed to mark batch as processed: {:?}", e);
    }

    state.processed_count += batch_count;

    // Log progress and flush UUIDs
    print_batch_progress(state, total_to_process);
    flush_new_uuids(&mut state.new_uuids_this_run, used_uuids_path)?;

    Ok(())
}

/// Extracts UUIDs from a batch of messages concurrently.
async fn extract_uuids_from_batch(
    messages: Vec<process::MessageBody>,
    sfs_domain: &Arc<String>,
    state: &mut ProcessingState,
) -> Vec<Uuid> {
    let extraction_futures: Vec<_> = messages
        .into_iter()
        .map(|msg| {
            let domain = Arc::clone(sfs_domain);
            tokio::task::spawn_blocking(move || {
                let found = msg
                    .body_html_sanitized
                    .as_ref()
                    .map(|body| process::extract_sfs_uuids(body, &domain))
                    .unwrap_or_default();
                (msg.id, found)
            })
        })
        .collect();

    let batch_results = join_all(extraction_futures).await;
    let mut batch_processed_ids = Vec::new();

    for result in batch_results {
        match result {
            Ok((msg_id, found_uuids)) => {
                for uuid in found_uuids {
                    if !state.all_found_uuids.contains(&uuid) {
                        state.all_found_uuids.insert(uuid);
                        state.new_uuids_this_run.insert(uuid);
                    }
                }
                batch_processed_ids.push(msg_id);
            }
            Err(e) => {
                eprintln!("Error processing message: {:?}", e);
            }
        }
    }

    batch_processed_ids
}

/// Prints progress for the current batch.
fn print_batch_progress(state: &ProcessingState, total_to_process: usize) {
    println!(
        "Progress: {}/{} messages processed, {} unique UUIDs found ({} new this run)",
        state.processed_count,
        total_to_process,
        state.all_found_uuids.len(),
        state.new_uuids_this_run.len()
    );
}

/// Flushes newly found UUIDs to file.
fn flush_new_uuids(new_uuids: &mut HashSet<Uuid>, path: &Path) -> anyhow::Result<()> {
    if !new_uuids.is_empty() {
        process::append_uuids_to_file(new_uuids, path)?;
        new_uuids.clear();
    }
    Ok(())
}

/// Prints the final summary.
fn print_summary(state: &ProcessingState, output_file: &str) {
    println!("\n=== Processing Complete ===");
    println!("Total messages processed: {}", state.processed_count);
    println!(
        "Total unique SFS UUIDs found: {}",
        state.all_found_uuids.len()
    );
    println!("Results saved to: {}", output_file);
}

/// Fetches batches from the database and sends them through the channel.
async fn fetch_batches(db_pool: PgPool, batches: Vec<Vec<Uuid>>, tx: mpsc::Sender<FetchedBatch>) {
    for batch_ids in batches {
        let fetch_start = Instant::now();
        match process::fetch_message_bodies_batch(&db_pool, &batch_ids).await {
            Ok(message_bodies) => {
                let fetch_duration = fetch_start.elapsed();
                let fetched_batch = FetchedBatch {
                    message_bodies,
                    fetch_duration,
                };
                if tx.send(fetched_batch).await.is_err() {
                    // Receiver dropped, stop fetching
                    break;
                }
            }
            Err(e) => {
                eprintln!("Error fetching batch of messages: {:?}", e);
                // Continue to next batch on error
            }
        }
    }
}
