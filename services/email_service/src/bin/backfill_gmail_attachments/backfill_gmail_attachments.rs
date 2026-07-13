//! # Attachment Backfill Utility
//!
//! This binary is used to find and upload relevant email attachments for a given user account.
//! It fetches attachment metadata from the local database based on several heuristics,
//! downloads the actual attachment data from Gmail, and uploads it to a document storage service.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//! - `DSS_URL`: The URL for the Document Storage Service.
//! - `INTERNAL_AUTH_KEY`: An access token for authenticating with internal Macro services.
//! - `MACRO_IDS`: The Macro IDs of the user accounts to backfill attachments for
//! - `UPLOAD_CONCURRENCY`: Number of concurrent uploads to process (optional, defaults to 10).
//! - `FUSIONAUTH_API_KEY`: The API key for authenticating with FusionAuth.
//! - `FUSIONAUTH_BASE_URL`: The base URL for the FusionAuth service.
//! - `FUSIONAUTH_IDENTITY_PROVIDER_ID`: The identity provider ID for FusionAuth.
//! - `GMAIL_CLIENT_ID`: The client ID for Gmail OAuth.
//! - `GMAIL_CLIENT_SECRET`: The client secret for Gmail OAuth.

mod auth;
mod config;
mod database;
mod process;
mod upload;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Loading configuration...");
    MacroEntrypoint::default().init();
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Connecting to the database...");
    let db_pool = database::create_db_pool(&config.database_url, config.upload_concurrency as u32)
        .await
        .context("Failed to create database pool")?;

    let dss_client = document_storage_service_client::DocumentStorageServiceClient::new(
        config.internal_auth_key.clone(),
        config.dss_url.clone(),
    );
    let gmail_client = gmail_client::GmailClient::new("unused".to_string());

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

        match process::process_macro_id(&config, &db_pool, &dss_client, &gmail_client, macro_id)
            .await
        {
            Ok((success_count, total_attachments)) => {
                println!(
                    "Completed processing for {}. Successfully uploaded {} out of {} attachments.",
                    macro_id, success_count, total_attachments
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
