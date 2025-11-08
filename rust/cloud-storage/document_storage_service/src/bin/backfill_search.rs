/// backfill_search.rs is used to trigger a backfill for document search
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use clap::Parser;
use macro_entrypoint::MacroEntrypoint;
use model::document::FileType;
use sqlx::postgres::PgPoolOptions;

#[derive(clap::Parser, Debug)]
struct Args {
    /// Comma separated list of file types to process
    #[arg(long = "file_types", short = 'f')]
    file_types: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let args = Args::parse();

    let file_types: Option<Vec<String>> = args
        .file_types
        .map(|s| s.split(',').map(|s| s.to_string()).collect());

    println!("Starting backfill_search with {file_types:?}");

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
        let documents = macro_db_client::document::get_documents_search::get_documents_for_search(
            &db,
            limit,
            offset,
            &file_types,
        )
        .await
        .context("Failed to get documents")?;

        if documents.is_empty() {
            tracing::trace!("no more documents to process");
            break;
        }

        total += documents.len();

        sqs_client
            .bulk_send_message_to_search_event_queue(
                documents
                    .iter()
                    .map(|v| {
                        if v.file_type == FileType::Md {
                            sqs_client::search::SearchQueueMessage::ExtractSync(v.into())
                        } else {
                            sqs_client::search::SearchQueueMessage::ExtractDocumentText(v.into())
                        }
                    })
                    .collect(),
            )
            .await?;

        println!("completed offset {offset} documents");

        offset += limit;
    }

    println!("Completed. Total threads processed: {}", total);

    Ok(())
}
