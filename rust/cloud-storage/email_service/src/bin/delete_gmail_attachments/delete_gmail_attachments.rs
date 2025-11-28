//! # Delete Gmail Attachment Utility
//!
//! This binary is used to delete any gmail attachments we uploaded for the user(s) from macro.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//! - `DSS_URL`: The URL for the Document Storage Service.
//! - `INTERNAL_AUTH_KEY`: An access token for authenticating with internal Macro services.
//! - `MACRO_IDS`: The Macro IDs of the user accounts to delete attachments for
//! - `DELETE_CONCURRENCY`: Number of concurrent uploads to process (optional, defaults to 10).

mod config;
mod database;
mod process;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Loading configuration...");
    MacroEntrypoint::default().init();
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Connecting to the database...");
    let db_pool = database::create_db_pool(&config.database_url, config.delete_concurrency as u32)
        .await
        .context("Failed to create database pool")?;

    let dss_client = document_storage_service_client::DocumentStorageServiceClient::new(
        config.internal_auth_key.clone(),
        config.dss_url.clone(),
    );
    let macro_ids: Vec<String> = config
        .macro_ids
        .split(',')
        .map(|id| id.trim().to_string())
        .collect();

    println!("Processing {} macro IDs: {:?}", macro_ids.len(), macro_ids);

    for (index, macro_id) in macro_ids.iter().enumerate() {
        println!(
            "\n=== Processing macro ID {} ({}/{}) ===",
            macro_id,
            index + 1,
            macro_ids.len()
        );

        match process::process_macro_id(&config, &db_pool, &dss_client, macro_id).await {
            Ok((success_count, total_documents)) => {
                println!(
                    "Completed processing for {}. Successfully deleted {} out of {} documents.",
                    macro_id, success_count, total_documents
                );
            }
            Err(e) => {
                println!("Failed to process macro ID {}: {:?}", macro_id, e);
                // Continue with next macro ID instead of failing completely
            }
        }
    }

    println!("\n=== All macro IDs processed ===");
    Ok(())
}
