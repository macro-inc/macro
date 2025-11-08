/// backfill_search.rs is used to trigger a backfill for document search
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    tracing::info!("starting backfill_search");

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

    let limit = 1000;
    let mut offset = 0;
    let mut total = 0;

    loop {
        let chats = macro_db_client::chat::get::get_chat_messages_for_search_backfill(
            &db, limit, offset, None, None,
        )
        .await
        .context("failed to get chats")?;

        if chats.is_empty() {
            tracing::info!("no more chats to process");
            break;
        }

        total += chats.len();

        sqs_client
            .bulk_send_message_to_search_event_queue(
                chats
                    .iter()
                    .map(|chat| {
                        sqs_client::search::SearchQueueMessage::ChatMessage(
                            sqs_client::search::chat::ChatMessage {
                                chat_id: chat.chat_id.clone(),
                                message_id: chat.message_id.clone(),
                                user_id: chat.user_id.clone(),
                                created_at: chat.created_at,
                                updated_at: chat.updated_at,
                            },
                        )
                    })
                    .collect(),
            )
            .await
            .context("failed to send messages to search event queue")?;

        tracing::info!(offset, "completed offset batch");

        offset += limit;
    }

    tracing::info!(total, "backfill complete");

    Ok(())
}
