/// backfill_entity_names.rs is used to trigger a backfill for the entity name index in OS
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
///
/// Usage:
/// cargo run backfill_entity_names.rs <COMMA_SEPARATED_LIST_OF_INDICES>
/// Example:
/// cargo run backfill_entity_names.rs chats,documents
use anyhow::Context;

use macro_entrypoint::MacroEntrypoint;
use models_opensearch::SearchEntityType;
use sqlx::postgres::PgPoolOptions;
use sqs_client::search::name::EntityName;
use std::future::Future;
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // 1. Parse CLI Arguments
    let args: Vec<String> = std::env::args().collect();

    let target_indices: Vec<SearchEntityType> = if args.len() < 2 {
        // Default to all supported entity types
        println!("No indices specified, backfilling all supported types");
        vec![
            SearchEntityType::Chats,
            SearchEntityType::Documents,
            SearchEntityType::Channels,
            SearchEntityType::Emails,
            // Note: Projects is not included as it's not implemented
        ]
    } else {
        let indices_arg = &args[1];
        indices_arg
            .split(',')
            .map(|s| {
                // Trim whitespace and parse using strum::EnumString derived on SearchEntityType
                SearchEntityType::from_str(s.trim())
                    .with_context(|| format!("Invalid entity index type: {}", s))
            })
            .collect::<anyhow::Result<_>>()?
    };

    if target_indices.is_empty() {
        println!("No valid indices provided to process.");
        return Ok(());
    }

    // Check if user is trying to backfill Projects
    if target_indices.contains(&SearchEntityType::Projects) {
        anyhow::bail!(
            "Backfill for 'projects' is not implemented. Supported types: chats, documents, channels, emails"
        );
    }

    println!("Starting backfill for indices: {:?}", target_indices);

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let db = Arc::new(
        PgPoolOptions::new()
            .min_connections(10)
            .max_connections(60)
            .connect(&database_url)
            .await?,
    );

    let search_event_queue =
        std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE not set")?;

    let queue_aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let sqs_client = Arc::new(
        sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
            .search_event_queue(&search_event_queue),
    );

    // Process all entity types in parallel
    let handles: Vec<_> = target_indices
        .into_iter()
        .map(|index| {
            let db = Arc::clone(&db);
            let sqs_client = Arc::clone(&sqs_client);

            tokio::spawn(async move {
                let result = match index {
                    SearchEntityType::Chats => {
                        backfill_entities(
                            &sqs_client,
                            "chats",
                            SearchEntityType::Chats,
                            |limit, offset| {
                                let db = Arc::clone(&db);
                                async move {
                                    macro_db_client::chat::get::get_all_chat_ids_paginated(
                                        &db, limit, offset,
                                    )
                                    .await
                                }
                            },
                        )
                        .await
                    }
                    SearchEntityType::Documents => {
                        backfill_entities(
                            &sqs_client,
                            "documents",
                            SearchEntityType::Documents,
                            |limit, offset| {
                                let db = Arc::clone(&db);
                                async move {
                                    macro_db_client::document::get_all_documents::get_all_document_ids_paginated(
                                        &db, limit, offset,
                                    )
                                    .await
                                }
                            },
                        )
                        .await
                    }
                    SearchEntityType::Channels => {
                        backfill_entities(
                            &sqs_client,
                            "channels",
                            SearchEntityType::Channels,
                            |limit, offset| {
                                let db = Arc::clone(&db);
                                async move {
                                    comms_db_client::channels::get_channels::get_all_channel_ids_paginated(
                                        &db, limit, offset,
                                    )
                                    .await
                                }
                            },
                        )
                        .await
                    }
                    SearchEntityType::Emails => {
                        backfill_entities(
                            &sqs_client,
                            "email threads",
                            SearchEntityType::Emails,
                            |limit, offset| {
                                let db = Arc::clone(&db);
                                async move {
                                    email_db_client::threads::get::get_all_thread_ids_paginated(
                                        &db, limit, offset,
                                    )
                                    .await
                                }
                            },
                        )
                        .await
                    }
                    SearchEntityType::Projects => {
                        unreachable!("Backfill logic for 'projects' is not implemented.");
                    }
                };

                (index, result)
            })
        })
        .collect();

    // Wait for all tasks and report results
    let mut had_errors = false;
    for handle in handles {
        match handle.await {
            Ok((index, Ok(()))) => {
                println!("Successfully completed backfill for {:?}", index);
            }
            Ok((index, Err(e))) => {
                eprintln!("Error backfilling {:?}: {:?}", index, e);
                had_errors = true;
            }
            Err(e) => {
                eprintln!("Task panicked: {:?}", e);
                had_errors = true;
            }
        }
    }

    if had_errors {
        anyhow::bail!("One or more backfill tasks failed");
    }

    Ok(())
}

/// Generic function to handle pagination, UUID parsing, and SQS queuing for any entity type
/// Uses concurrent batch processing for improved throughput
async fn backfill_entities<F, Fut>(
    sqs_client: &sqs_client::SQS,
    name: &str,
    entity_type: SearchEntityType,
    fetcher: F,
) -> anyhow::Result<()>
where
    F: Fn(i64, i64) -> Fut + Send + Sync,
    Fut: Future<Output = anyhow::Result<Vec<String>>> + Send,
{
    let limit = 5000;
    let mut offset = 0;
    let mut count = 0;

    loop {
        println!("[{}] fetching batch at offset {}", name, offset);

        let ids = fetcher(limit, offset).await?;
        println!("[{}] got {} ids at offset {}", name, ids.len(), offset);

        if ids.is_empty() {
            tracing::trace!("no more {name} found");
            break;
        }

        count += ids.len();

        let messages: Vec<_> = ids
            .iter()
            .map(|id| {
                sqs_client::search::SearchQueueMessage::UpdateEntityName(EntityName {
                    entity_id: Uuid::parse_str(id)
                        .with_context(|| format!("Failed to parse UUID from {}: {}", name, id))
                        .unwrap(),
                    entity_type: entity_type.clone(),
                })
            })
            .collect();

        sqs_client
            .bulk_send_message_to_search_event_queue(messages)
            .await?;

        println!("[{}] queued batch at offset {}", name, offset);

        offset += limit;
    }

    println!("[{}] Completed. Total processed: {}", name, count);
    Ok(())
}
