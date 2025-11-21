//! This module handles the processing of entity name messages

use opensearch_client::{OpensearchClient, upsert::name::UpsertEntityNameArgs};
use sqs_client::search::name::UpdateEntityName;

/// Handles upserting the name for an entity
#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn upsert_name(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &UpdateEntityName,
) -> anyhow::Result<()> {
    // Get entity name from db
    let entity_name =
        macro_db_client::entity_name::get_entity_name(db, &message.entity_id, &message.entity_type)
            .await?;

    let name = if let Some(entity_name) = entity_name {
        entity_name
    } else {
        return Ok(());
    };

    // Perform upsert
    opensearch_client
        .upsert_entity_name(&UpsertEntityNameArgs {
            entity_id: message.entity_id.to_string(),
            name,
            entity_type: message.entity_type.clone(),
        })
        .await?;

    Ok(())
}
