use crate::{CONCURRENT_PROCESSING_LIMIT, DB_FETCH_SIZE, INSERT_BATCH_SIZE};
use anyhow::Context;
use chrono::Utc;
use comms_service_client::CommsServiceClient;
use futures::future::join_all;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::PgPool;

pub async fn process_single_project(
    db: PgPool,
    comms_service_client: CommsServiceClient,
    project_id: String,
    user_id: String,
) -> anyhow::Result<Vec<UserItemAccess>> {
    let mut generated_items = Vec::new();

    // Add row for the owner
    generated_items.push(UserItemAccess {
        id: macro_uuid::generate_uuid_v7(),
        user_id: user_id.clone(),
        item_id: project_id.clone(),
        item_type: "project".to_string(),
        access_level: AccessLevel::Owner,
        granted_from_channel_id: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    });

    // Get share permissions
    let sp = macro_db_client::share_permission::get::get_project_share_permission(&db, &project_id)
        .await
        .with_context(|| format!("Failed to get share permission for project {}", project_id))?;

    // Get participants
    for csp in sp.channel_share_permissions.unwrap_or_default() {
        let channel_id = uuid::Uuid::parse_str(&csp.channel_id)
            .with_context(|| format!("Failed to parse channel UUID: {}", csp.channel_id))?;

        let participants = comms_service_client
            .get_channel_participants(&csp.channel_id)
            .await
            .with_context(|| {
                format!("Failed to get participants for channel {}", csp.channel_id)
            })?;

        for participant in participants {
            if participant.user_id != user_id {
                generated_items.push(UserItemAccess {
                    id: macro_uuid::generate_uuid_v7(),
                    user_id: participant.user_id,
                    item_id: project_id.clone(),
                    item_type: "project".to_string(),
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

/// Backfills UserItemAccess records for projects with concurrent processing.
pub async fn backfill_projects_updated(
    db: &PgPool,
    comms_service_client: &CommsServiceClient,
    start_offset: Option<i64>,
) -> anyhow::Result<()> {
    let mut offset = start_offset.unwrap_or(0);

    if let Some(so) = start_offset {
        println!("Starting project backfill from custom offset: {}", so);
    } else {
        println!("Starting project backfill from the beginning (streaming/concurrent version)");
    }

    let mut total_projects_processed = 0;
    let mut total_items_inserted = 0;
    let mut items_to_insert: Vec<UserItemAccess> = Vec::with_capacity(INSERT_BATCH_SIZE);

    loop {
        // 1. FETCH
        let projects_batch = macro_db_client::projects::get_all_project_ids_with_users_paginated(
            db,
            DB_FETCH_SIZE,
            offset,
        )
        .await
        .context("failed to get a batch of projects")?;

        let num_in_batch = projects_batch.len();
        if num_in_batch == 0 {
            println!(
                "No more projects found at offset {}. Concluding project backfill.",
                offset
            );
            break;
        }

        println!(
            "Fetched batch of {} projects at offset {}. Processing concurrently...",
            num_in_batch, offset
        );

        // 2. PROCESS concurrently in chunks
        for chunk in projects_batch.chunks(CONCURRENT_PROCESSING_LIMIT) {
            let mut tasks = Vec::new();
            for (project_id, user_id) in chunk {
                let db_clone = db.clone();
                let client_clone = comms_service_client.clone();
                let project_id_clone = project_id.clone();
                let user_id_clone = user_id.clone();

                tasks.push(tokio::spawn(process_single_project(
                    db_clone,
                    client_clone,
                    project_id_clone,
                    user_id_clone,
                )));
            }

            for result in join_all(tasks).await {
                match result {
                    Ok(Ok(generated_items)) => items_to_insert.extend(generated_items),
                    Ok(Err(e)) => eprintln!("ERROR: A project processing task failed: {:?}", e),
                    Err(e) => eprintln!("ERROR: A project processing task panicked: {:?}", e),
                }
            }
        }

        total_projects_processed += num_in_batch;

        // 3. INSERT
        if items_to_insert.len() >= INSERT_BATCH_SIZE {
            let batch: Vec<_> = std::mem::take(&mut items_to_insert);
            macro_db_client::item_access::insert::insert_user_item_access_batch(db, &batch)
                .await
                .context("failed to insert user item access batch")?;

            total_items_inserted += batch.len();
            println!(
                "Inserted batch of {} access records (total inserted this run: {})",
                batch.len(),
                total_items_inserted
            );
        }

        // 4. PREPARE for next iteration
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
        "Project backfill complete! Processed {} projects and inserted {} access records in this run.",
        total_projects_processed, total_items_inserted
    );

    Ok(())
}
