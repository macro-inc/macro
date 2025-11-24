//! This module handles the processing of entity name messages

use opensearch_client::{OpensearchClient, upsert::name::UpsertEntityNameArgs};
use sqs_client::search::name::EntityName;

/// Handles upserting the name for an entity
#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn upsert_name(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &EntityName,
) -> anyhow::Result<()> {
    let (entity_name, user_id) = macro_db_client::entity_name::get_entity_name_and_owner(
        db,
        &message.entity_id,
        &message.entity_type,
    )
    .await?;

    let name = if let Some(entity_name) = entity_name {
        entity_name
    } else {
        return Ok(());
    };

    if name.is_empty() {
        return Ok(());
    }

    // Perform upsert
    opensearch_client
        .upsert_entity_name(&UpsertEntityNameArgs {
            entity_id: message.entity_id.to_string(),
            name,
            user_id,
            entity_type: message.entity_type.clone(),
        })
        .await?;

    Ok(())
}

/// Handles removing the name for an entity
#[tracing::instrument(skip(opensearch_client), err)]
pub async fn remove_name(
    opensearch_client: &OpensearchClient,
    message: &EntityName,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_entity_name(&message.entity_id.to_string(), &message.entity_type)
        .await?;

    Ok(())
}
