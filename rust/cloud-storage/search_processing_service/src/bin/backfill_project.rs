/// backfill_chat.rs is used to trigger a backfill for chats
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_TEXT_EXTRACTOR_QUEUE
use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::project::ProjectMessage;

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

    let queue_aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
        .search_event_queue(&search_event_queue);

    let limit = 5000;
    let mut offset = 0;
    let mut count = 0;
    loop {
        tracing::info!(limit=%limit, offset=%offset, "getting chats");

        let projects =
            macro_db_client::projects::get_all_project_ids_with_users_paginated(&db, limit, offset)
                .await?;
        println!("got batch offset {offset}");

        if projects.is_empty() {
            tracing::trace!("no more projects found");
            break;
        }

        count += projects.len();

        tracing::trace!(projects = projects.len(), "ready to queue projects");

        sqs_client
            .bulk_send_message_to_search_event_queue(
                projects
                    .iter()
                    .map(|(project_id, user_id)| {
                        sqs_client::search::SearchQueueMessage::ProjectMessage(ProjectMessage {
                            project_id: project_id.clone(),
                            macro_user_id: user_id.clone(),
                        })
                    })
                    .collect(),
            )
            .await?;
        println!("queued batch");

        // // Set offset for next iteration
        offset += limit;
    }

    println!("Completed. Total chats processed: {}", count);

    Ok(())
}
