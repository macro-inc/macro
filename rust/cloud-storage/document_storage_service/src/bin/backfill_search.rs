/// backfill_search.rs is used to trigger a backfill for document search
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use chrono::{DateTime, Utc};
use clap::Parser;
use macro_entrypoint::MacroEntrypoint;
use model::document::FileType;
use sqlx::postgres::PgPoolOptions;

#[derive(clap::Parser, Debug)]
struct Args {
    /// Comma separated list of file types to process
    #[arg(long = "file_types", short = 'f')]
    file_types: Option<String>,
    /// Filter to only documents with this sub type (e.g. "task")
    #[arg(long = "sub_type", short = 's')]
    sub_type: Option<String>,
    /// Only include documents created after this time (ISO 8601, e.g. "2026-03-24T00:00:00Z")
    #[arg(long = "created_after")]
    created_after: Option<DateTime<Utc>>,
    /// Only include documents created before this time (ISO 8601, e.g. "2026-03-25T00:00:00Z")
    #[arg(long = "created_before")]
    created_before: Option<DateTime<Utc>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let args = Args::parse();

    let file_types: Option<Vec<String>> = args
        .file_types
        .map(|s| s.split(',').map(|s| s.to_string()).collect());
    let sub_type = args.sub_type;
    let created_after = args.created_after;
    let created_before = args.created_before;

    println!(
        "Starting backfill_search with file_types={file_types:?} sub_type={sub_type:?} created_after={created_after:?} created_before={created_before:?}"
    );

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let db = PgPoolOptions::new()
        .min_connections(10)
        .max_connections(60)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let search_event_queue =
        std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE not set")?;

    let queue_aws_config = macro_aws_config::get_macro_aws_config().await;

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
            &sub_type,
            &created_after,
            &created_before,
        )
        .await
        .context("Failed to get documents")?;

        if documents.is_empty() {
            tracing::trace!("no more documents to process");
            break;
        }

        let first_created = documents.first().and_then(|d| d.created_at);
        let last_created = documents.last().and_then(|d| d.created_at);

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

        println!(
            "completed batch: offset={offset} count={} created_at=[{} .. {}]",
            documents.len(),
            first_created.map_or("N/A".to_string(), |t| t.to_rfc3339()),
            last_created.map_or("N/A".to_string(), |t| t.to_rfc3339()),
        );

        offset += limit;
    }

    println!("Completed. Total threads processed: {}", total);

    Ok(())
}
