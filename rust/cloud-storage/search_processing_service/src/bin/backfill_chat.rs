/// backfill_chat.rs is used to trigger a backfill for chats
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::chat::ChatMessage;

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

        let chats = macro_db_client::chat::get::get_chat_messages_for_search_backfill(
            &db, limit, offset, None, None,
        )
        .await?;
        println!("got batch offset {offset}");

        if chats.is_empty() {
            tracing::trace!("no chats more found");
            break;
        }

        count += chats.len();

        tracing::trace!(chats = chats.len(), "ready to queue chats");

        sqs_client
            .bulk_send_message_to_search_event_queue(
                chats
                    .iter()
                    .map(|chat| {
                        sqs_client::search::SearchQueueMessage::ChatMessage(ChatMessage {
                            chat_id: chat.chat_id.clone(),
                            message_id: chat.message_id.clone(),
                            user_id: chat.user_id.clone(),
                            created_at: chat.created_at,
                            updated_at: chat.updated_at,
                        })
                    })
                    .collect(),
            )
            .await?;
        println!("queued batch");

        // Set offset for next iteration
        offset += limit;
    }

    println!("Completed. Total chats processed: {}", count);

    Ok(())
}
