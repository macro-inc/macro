/// backfill_chat.rs is used to trigger a backfill for chats
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::channel::ChannelMessageUpdate;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
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
        let messages =
            comms_db_client::messages::get_messages::get_channel_messages(&db, limit, offset)
                .await?;

        println!("got batch offset {offset}");

        if messages.is_empty() {
            println!("no more messages found");
            break;
        }
        count += messages.len();

        sqs_client
            .bulk_send_message_to_search_event_queue(
                messages
                    .iter()
                    .map(|(channel_id, message_id)| {
                        sqs_client::search::SearchQueueMessage::ChannelMessageUpdate(
                            ChannelMessageUpdate {
                                channel_id: channel_id.to_string(),
                                message_id: message_id.to_string(),
                            },
                        )
                    })
                    .collect(),
            )
            .await?;
        println!("queued batch");

        // Set offset for next iteration
        offset += limit;
    }

    println!("Completed. Total chats processed: {count}");

    Ok(())
}
