//! backfill_useritemaccess.rs is used to trigger a backfill for the UserItemAccess table
//! - DATABASE_URL
//! - DOCUMENT_STORAGE_SERVICE_AUTH_KEY
//! - COMMS_SERVICE_URL
mod chat;
mod document;
mod project;

use anyhow::Context;
use comms_service_client::CommsServiceClient;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

// the number of useritemaccess records we insert at once
const INSERT_BATCH_SIZE: usize = 10000;

// the number of items we fetch from the db to process at once
const DB_FETCH_SIZE: i64 = 10000;

// the number of concurrent processes we use for fetching permission info for items
const CONCURRENT_PROCESSING_LIMIT: usize = 25;

/// Checks if a backfill process is enabled via an environment variable.
/// The variable must be set to "true" (case-insensitive) to be considered enabled.
fn is_backfill_enabled(var_name: &str) -> bool {
    match std::env::var(var_name) {
        Ok(val) => val.eq_ignore_ascii_case("true"),
        Err(_) => false, // If not set, it's disabled.
    }
}

/// Gets a numeric offset from an environment variable.
/// Returns Some(offset) if the variable is set and is a valid number, otherwise None.
fn get_offset(var_name: &str) -> Option<i64> {
    match std::env::var(var_name) {
        Ok(val) => match val.parse::<i64>() {
            Ok(offset) => {
                println!("-> Found custom offset for {}: {}", var_name, offset);
                Some(offset)
            }
            Err(_) => {
                eprintln!(
                    "WARN: Could not parse value for {} ('{}'). Defaulting to no offset.",
                    var_name, val
                );
                None
            }
        },
        Err(_) => None, // Variable is not set, so no offset.
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    println!("Starting backfill_useritemaccess script");

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let comms_internal_key = std::env::var("DOCUMENT_STORAGE_SERVICE_AUTH_KEY")
        .context("DOCUMENT_STORAGE_SERVICE_AUTH_KEY not set")?;
    let comms_service_url =
        std::env::var("COMMS_SERVICE_URL").context("COMMS_SERVICE_URL not set")?;

    let db = PgPoolOptions::new()
        .min_connections(10)
        .max_connections(60)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let comms_service_client = CommsServiceClient::new(comms_internal_key, comms_service_url);

    // --- Backfill Logic Controlled by Environment Variables ---

    if is_backfill_enabled("BACKFILL_CHATS") {
        let offset = get_offset("CHAT_OFFSET");
        chat::backfill_chats_updated(&db, &comms_service_client, offset).await?;
    } else {
        println!("Skipping chat backfill: BACKFILL_CHATS is not set to 'true'.");
    }

    if is_backfill_enabled("BACKFILL_DOCUMENTS") {
        let offset = get_offset("DOCS_OFFSET");
        document::backfill_documents_updated(&db, &comms_service_client, offset).await?;
    } else {
        println!("Skipping document backfill: BACKFILL_DOCUMENTS is not set to 'true'.");
    }

    if is_backfill_enabled("BACKFILL_PROJECTS") {
        let offset = get_offset("PROJECTS_OFFSET");
        project::backfill_projects_updated(&db, &comms_service_client, offset).await?;
    } else {
        println!("Skipping project backfill: BACKFILL_PROJECTS is not set to 'true'.");
    }

    println!("Backfill script finished!");

    Ok(())
}
