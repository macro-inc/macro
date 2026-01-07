use crate::{CONCURRENT_PROCESSING_LIMIT, DB_FETCH_SIZE, INSERT_BATCH_SIZE};
use anyhow::Context;
use chrono::Utc;
use comms_service_client::CommsServiceClient;
use futures::future::join_all;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::PgPool;

async fn process_single_chat(
    db: PgPool,
    comms_service_client: CommsServiceClient,
    chat_id: String,
    user_id: String,
) -> anyhow::Result<Vec<UserItemAccess>> {
    let mut generated_items = Vec::new();

    // Add row for the owner of the item
    generated_items.push(UserItemAccess {
        id: macro_uuid::generate_uuid_v7(),
        user_id: user_id.clone(),
        item_id: chat_id.clone(),
        item_type: "chat".to_string(),
        access_level: AccessLevel::Owner,
        granted_from_channel_id: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    });

    // Get channel share permissions
    let sp = macro_db_client::share_permission::get::get_chat_share_permission(&db, &chat_id)
        .await
        .with_context(|| format!("Failed to get share permission for chat {}", chat_id))?;

    // Get participants for each shared channel
    for csp in sp.channel_share_permissions.unwrap_or_default() {
        let channel_id = uuid::Uuid::parse_str(&csp.channel_id)
            .with_context(|| format!("Failed to parse channel UUID: {}", csp.channel_id))?;

        let participants = comms_service_client
            .get_channel_participants(&csp.channel_id)
            .await
            .with_context(|| {
                format!("Failed to get participants for channel {}", csp.channel_id)
            })?;

        // Add an access record for each participant
        for participant in participants {
            if participant.user_id != user_id {
                generated_items.push(UserItemAccess {
                    id: macro_uuid::generate_uuid_v7(),
                    user_id: participant.user_id,
                    item_id: chat_id.clone(),
                    item_type: "chat".to_string(),
                    access_level: csp.access_level,
                    granted_from_channel_id: Some(channel_id),
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                });
            }
        }
    }

    Ok(generated_items)
}

/// Backfills UserItemAccess records for chats with concurrent processing.
pub async fn backfill_chats_updated(
    db: &PgPool,
    comms_service_client: &CommsServiceClient,
    start_offset: Option<i64>,
) -> anyhow::Result<()> {
    let mut offset = start_offset.unwrap_or(0);

    if let Some(so) = start_offset {
        println!("Starting chat backfill from custom offset: {}", so);
    } else {
        println!("Starting chat backfill from the beginning (streaming/concurrent version)");
    }

    let mut total_chats_processed = 0;
    let mut total_items_inserted = 0;
    let mut items_to_insert: Vec<UserItemAccess> = Vec::with_capacity(INSERT_BATCH_SIZE);

    loop {
        // 1. FETCH a batch of chats from the database
        let chats_batch = macro_db_client::chat::get::get_all_chat_ids_with_users_paginated(
            db,
            DB_FETCH_SIZE,
            offset,
        )
        .await
        .context("failed to get a batch of chats")?;

        let num_in_batch = chats_batch.len();
        if num_in_batch == 0 {
            println!(
                "No more chats found at offset {}. Concluding chat backfill.",
                offset
            );
            break;
        }

        println!(
            "Fetched batch of {} chats at offset {}. Processing concurrently...",
            num_in_batch, offset
        );

        // 2. PROCESS the fetched batch concurrently, in chunks
        for chunk in chats_batch.chunks(CONCURRENT_PROCESSING_LIMIT) {
            let mut tasks = Vec::new();
            for (chat_id, user_id) in chunk {
                // Clone the resources needed for the concurrent task.
                // Cloning PgPool and the client should be cheap.
                let db_clone = db.clone();
                let client_clone = comms_service_client.clone();
                let chat_id_clone = chat_id.clone();
                let user_id_clone = user_id.clone();

                tasks.push(tokio::spawn(process_single_chat(
                    db_clone,
                    client_clone,
                    chat_id_clone,
                    user_id_clone,
                )));
            }

            // Wait for all tasks in the current chunk to complete
            let results = join_all(tasks).await;

            // Collect the results
            for result in results {
                match result {
                    // Task completed successfully
                    Ok(Ok(generated_items)) => {
                        items_to_insert.extend(generated_items);
                    }
                    // Task completed but returned an error
                    Ok(Err(e)) => {
                        eprintln!("ERROR: A chat processing task failed: {:?}", e);
                    }
                    // Task panicked or was cancelled
                    Err(e) => {
                        eprintln!("ERROR: A chat processing task panicked: {:?}", e);
                    }
                }
            }
        }

        total_chats_processed += num_in_batch;

        // 3. INSERT the generated items if the batch is full
        if items_to_insert.len() >= INSERT_BATCH_SIZE {
            let items_to_drain = items_to_insert.len();
            let batch: Vec<_> = std::mem::take(&mut items_to_insert);

            macro_db_client::item_access::insert::insert_user_item_access_batch(db, &batch)
                .await
                .context("failed to insert user item access batch")?;

            total_items_inserted += items_to_drain;
            println!(
                "Inserted batch of {} access records (total inserted this run: {})",
                items_to_drain, total_items_inserted
            );
        }

        // 4. PREPARE for the next iteration
        if num_in_batch < DB_FETCH_SIZE as usize {
            break;
        }
        offset += DB_FETCH_SIZE;
    }

    // Insert any remaining items
    if !items_to_insert.is_empty() {
        let items_count = items_to_insert.len();
        macro_db_client::item_access::insert::insert_user_item_access_batch(db, &items_to_insert)
            .await
            .context("failed to insert final user item access batch")?;

        total_items_inserted += items_count;
        println!("Inserted final batch of {} access records.", items_count);
    }

    println!(
        "Chat backfill complete! Processed {} chats and inserted {} access records in this run.",
        total_chats_processed, total_items_inserted
    );

    Ok(())
}
