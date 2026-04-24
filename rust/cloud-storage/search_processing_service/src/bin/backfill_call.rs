use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::call::CallRecordMessage;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let db = PgPoolOptions::new()
        .min_connections(5)
        .max_connections(30)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let search_event_queue =
        std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE not set")?;

    let queue_aws_config = macro_aws_config::get_macro_aws_config().await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
        .search_event_queue(&search_event_queue);

    let limit = 2000;
    let mut offset = 0;
    let mut count = 0;
    loop {
        tracing::info!(limit = %limit, offset = %offset, "getting call records");

        let records = macro_db_client::call_record::get::get_call_records_for_search_backfill(
            &db, limit, offset,
        )
        .await?;
        tracing::info!(%offset, fetched = records.len(), "fetched batch");

        if records.is_empty() {
            tracing::info!("no more call records found");
            break;
        }

        count += records.len();

        sqs_client
            .bulk_send_message_to_search_event_queue(
                records
                    .iter()
                    .map(|r| {
                        sqs_client::search::SearchQueueMessage::CallRecord(CallRecordMessage {
                            call_id: r.call_id.to_string(),
                        })
                    })
                    .collect(),
            )
            .await?;
        tracing::info!(%offset, "queued batch");

        offset += limit;
    }

    tracing::info!(total = count, "completed call record backfill");

    Ok(())
}
