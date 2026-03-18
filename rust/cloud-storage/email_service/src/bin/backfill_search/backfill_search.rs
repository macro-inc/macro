/// backfill_search.rs is used to trigger a backfill for email search across all threads available
/// in the email_db.
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
///
/// Optional:
/// - SINCE: ISO 8601 timestamp to only backfill threads updated since that time
///   e.g. SINCE=2026-03-16T00:00:00Z
/// - EMAIL_INDEX_OVERRIDE: Override the target OpenSearch index for email upserts
///   e.g. EMAIL_INDEX_OVERRIDE=emails_v2
/// - BATCH_SIZE: Number of threads per SQS batch message (default: 50)
///   e.g. BATCH_SIZE=100
use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::{SearchQueueMessage, email::EmailThreadBatchMessage};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let db = PgPoolOptions::new()
        .min_connections(10)
        .max_connections(60)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let search_event_queue =
        std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE not set")?;

    let since = std::env::var("SINCE")
        .ok()
        .map(|s| {
            s.parse::<chrono::DateTime<chrono::Utc>>()
                .context("SINCE must be a valid ISO 8601 timestamp (e.g. 2026-03-16T00:00:00Z)")
        })
        .transpose()?;

    let index_override = std::env::var("EMAIL_INDEX_OVERRIDE").ok();

    let batch_size: usize = std::env::var("BATCH_SIZE")
        .unwrap_or("50".to_string())
        .parse()
        .context("BATCH_SIZE must be a valid number")?;

    if let Some(ref index) = index_override {
        println!("Index override: {}", index);
    }

    let queue_aws_config = macro_aws_config::get_macro_aws_config().await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
        .search_event_queue(&search_event_queue);

    if let Some(since) = &since {
        println!("Backfilling threads updated since: {}", since);
    } else {
        println!("Backfilling all threads");
    }

    let limit = 1000;
    let mut offset = 0;
    let mut total = 0;

    loop {
        let thread_and_macro_user_ids = match since {
            Some(since) => {
                email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id_since(
                    &db, limit, offset, since,
                )
                .await
                .context("Failed to get thread ids with macro user id")?
            }
            None => email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id(
                &db, limit, offset,
            )
            .await
            .context("Failed to get thread ids with macro user id")?,
        };

        if thread_and_macro_user_ids.is_empty() {
            tracing::trace!("no more thread ids with macro user id to process");
            break;
        }

        total += thread_and_macro_user_ids.len();

        let mut user_threads: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for (thread_id, macro_user_id) in thread_and_macro_user_ids {
            user_threads
                .entry(macro_user_id)
                .or_default()
                .push(thread_id.to_string());
        }

        let search_messages: Vec<SearchQueueMessage> = user_threads
            .into_iter()
            .flat_map(|(macro_user_id, thread_ids)| {
                thread_ids
                    .chunks(batch_size)
                    .map(|chunk| {
                        SearchQueueMessage::ExtractEmailThreadBatch(EmailThreadBatchMessage {
                            thread_ids: chunk.to_vec(),
                            macro_user_id: macro_user_id.clone(),
                            index_override: index_override.clone(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        sqs_client
            .bulk_send_message_to_search_event_queue(search_messages)
            .await
            .context("failed to send search messages to search extractor queue")?;

        offset += limit;
    }

    println!("Completed. Total threads processed: {}", total);

    Ok(())
}
