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
        .min_connections(5)
        .max_connections(60)
        .connect(&config.database_url)
        .await
        .context("Could not connect to db")?;

    let macro_ids: Vec<String> = config
        .macro_ids
        .split(',')
        .map(|id| id.trim().to_string())
        .collect();

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .contacts_queue(&config.contacts_queue);

    println!("Processing {} macro IDs: {:?}", macro_ids.len(), macro_ids);

    for (index, macro_id) in macro_ids.iter().enumerate() {
        println!(
            "\n=== Processing macro ID {} ({}/{}) ===",
            macro_id,
            index + 1,
            macro_ids.len()
        );

        match process::process_macro_id(&config, &db_pool, &sqs_client, macro_id).await {
            Ok(()) => {
                println!("Completed processing for {}.", macro_id);
            }
            Err(e) => {
                // println!("Failed to process macro ID {}: {:?}", macro_id, e);
                panic!("Failed to process macro ID {}", macro_id);
            }
        }
    }

    println!("\n=== All macro IDs processed ===");
    Ok(())
}
