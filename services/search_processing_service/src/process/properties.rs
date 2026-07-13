use std::str::FromStr;

use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{OpensearchClient, upsert::properties::IndexedProperty};
use properties::outbound::entity_properties_get_query::{
    IndexedEntityProperty, get_entity_properties_for_index,
};
use sqs_client::search::document::DocumentPropertiesUpdate;

/// Refresh only the indexed `properties` of an entity after a property
/// mutation, without re-extracting its content. Fetches once, then routes to
/// the writer for the index that holds the entity type. Entity types without
/// a property-indexing search index are a no-op.
pub async fn process_entity_property_update(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &DocumentPropertiesUpdate,
) -> anyhow::Result<()> {
    let entity_id = &message.document_id;
    let entity_type = EntityType::from_str(&message.entity_type)
        .with_context(|| format!("invalid entity_type '{}'", message.entity_type))?;

    let rows = get_entity_properties_for_index(db, entity_id, entity_type)
        .await
        .context("failed to fetch properties for reindex")?;
    let properties = to_indexed_properties(rows);

    match entity_type {
        EntityType::Task | EntityType::Document => opensearch_client
            .update_document_properties(entity_id, &properties)
            .await
            .context("failed to update document properties in search index"),
        EntityType::Thread => opensearch_client
            .update_email_thread_properties(entity_id, &properties)
            .await
            .context("failed to update email thread properties in search index"),
        EntityType::Chat => opensearch_client
            .update_chat_properties(entity_id, &properties)
            .await
            .context("failed to update chat properties in search index"),
        EntityType::Project => opensearch_client
            .update_project_properties(entity_id, &properties)
            .await
            .context("failed to update project properties in search index"),
        EntityType::CallRecord => opensearch_client
            .update_call_record_properties(entity_id, &properties)
            .await
            .context("failed to update call record properties in search index"),
        other => {
            tracing::warn!(
                entity_type = %other,
                entity_id = %entity_id,
                "property update for unindexed entity type"
            );
            Ok(())
        }
    }
}

/// Convert DB-flattened properties into the search index's document shape.
pub fn to_indexed_properties(properties: Vec<IndexedEntityProperty>) -> Vec<IndexedProperty> {
    properties
        .into_iter()
        .map(|p| IndexedProperty {
            definition_id: p.definition_id,
            values: p.values,
            number_value: p.number_value,
            date_value: p.date_value,
        })
        .collect()
}
