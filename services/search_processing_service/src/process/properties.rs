use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient,
    upsert::properties::{IndexedProperty, PropertyUpdate},
};
use properties::outbound::entity_properties_get_query::{
    IndexedEntityProperty, get_entity_properties_for_index,
};

/// What refreshing an entity's indexed properties did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropertyRefresh {
    /// The entity's search documents now carry its properties.
    Written,
    /// The index holds no document for the entity yet, so nothing changed.
    NotIndexed,
    /// The entity's type has no search index that holds properties.
    UnindexedType,
}

/// Refresh only the indexed `properties` of an entity after a property
/// mutation, without re-extracting its content. Fetches once, then routes to
/// the writer for the index that holds the entity type. Entity types without
/// a property-indexing search index are a no-op.
pub async fn process_entity_property_update(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    entity_id: &str,
    entity_type: EntityType,
) -> anyhow::Result<PropertyRefresh> {
    let rows = get_entity_properties_for_index(db, entity_id, entity_type)
        .await
        .context("failed to fetch properties for reindex")?;
    let properties = to_indexed_properties(rows);

    let update = match entity_type {
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
        EntityType::CalendarEvent => opensearch_client
            .update_calendar_event_properties(entity_id, &properties)
            .await
            .context("failed to update calendar event properties in search index"),
        other @ (EntityType::Channel
        | EntityType::Company
        | EntityType::Contact
        | EntityType::DatabaseRow
        | EntityType::Initiative
        | EntityType::User) => {
            tracing::warn!(
                entity_type = %other,
                entity_id = %entity_id,
                "property update for unindexed entity type"
            );
            return Ok(PropertyRefresh::UnindexedType);
        }
    }?;
    Ok(match update {
        PropertyUpdate::Applied => PropertyRefresh::Written,
        PropertyUpdate::NotIndexed => PropertyRefresh::NotIndexed,
    })
}

/// Convert DB-flattened properties into the search index's document shape.
pub fn to_indexed_properties(properties: Vec<IndexedEntityProperty>) -> Vec<IndexedProperty> {
    properties
        .into_iter()
        .map(|p| IndexedProperty {
            definition_id: p.definition_id,
            entity_type: p.entity_type,
            values: p.values,
            number_value: p.number_value,
            date_value: p.date_value,
        })
        .collect()
}

#[cfg(test)]
mod test;
