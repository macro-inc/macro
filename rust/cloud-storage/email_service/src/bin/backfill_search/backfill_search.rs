/// backfill_search.rs is used to trigger a backfill for email search across all threads available
/// in the email_db.
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::{SearchQueueMessage, email::EmailThreadMessage};

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

    let queue_aws_config = if cfg!(feature = "local_queue") {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .endpoint_url(&search_event_queue)
            .load()
            .await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    };

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
        .search_event_queue(&search_event_queue);

    let limit = 1000;
    let mut offset = 0;
    let mut total = 0;

    loop {
        let thread_and_macro_user_ids =
            email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id(
                &db, limit, offset,
            )
            .await
            .context("Failed to get thread ids with macro user id")?;

        if thread_and_macro_user_ids.is_empty() {
            tracing::trace!("no more thread ids with macro user id to process");
            break;
        }

        total += thread_and_macro_user_ids.len();

        let search_messages: Vec<SearchQueueMessage> = thread_and_macro_user_ids
            .into_iter()
            .map(|(thread_id, macro_user_id)| {
                SearchQueueMessage::ExtractEmailThreadMessage(EmailThreadMessage {
                    thread_id: thread_id.to_string(),
                    macro_user_id,
                })
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
