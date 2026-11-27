use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient,
    upsert::properties::{IndexedProperty, PropertyUpdate},
};
use properties::outbound::entity_properties_get_query::{
    IndexedEntityProperty, get_entity_properties_for_index,
};
use rootcause::Report;
use uuid::Uuid;

use crate::{
    EmailIndexer,
    domain::email_index::{EmailWriter, LeasePool},
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
    /// The index refused some of the rewrite because a later writer already
    /// wrote those documents, properties included.
    RefusedStale,
}

/// Why refreshing an entity's indexed properties failed.
#[derive(Debug)]
pub enum PropertyRefreshError {
    /// The fenced rewrite of an email thread.
    EmailThread(Report),
    /// Any other entity type's property write.
    Other(anyhow::Error),
}

impl From<anyhow::Error> for PropertyRefreshError {
    fn from(error: anyhow::Error) -> Self {
        Self::Other(error)
    }
}

/// Refresh the indexed `properties` of an entity after a property mutation.
/// An email thread's documents are rewritten whole under the thread's lease:
/// a partial update cannot carry the version every email write is fenced by.
/// Other types fetch their properties once and update only that field, in the
/// index that holds the type. Entity types without a property-indexing search
/// index are a no-op.
pub async fn process_entity_property_update(
    opensearch_client: &OpensearchClient,
    email_indexer: &EmailIndexer,
    db: &sqlx::Pool<sqlx::Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    lease_pool: LeasePool,
) -> Result<PropertyRefresh, PropertyRefreshError> {
    let properties = || async {
        get_entity_properties_for_index(db, entity_id, entity_type)
            .await
            .map(to_indexed_properties)
            .context("failed to fetch properties for reindex")
    };

    let update = match entity_type {
        EntityType::Thread => {
            return refresh_email_thread(email_indexer, entity_id, lease_pool).await;
        }
        EntityType::Task | EntityType::Document => opensearch_client
            .update_document_properties(entity_id, &properties().await?)
            .await
            .context("failed to update document properties in search index"),
        EntityType::Chat => opensearch_client
            .update_chat_properties(entity_id, &properties().await?)
            .await
            .context("failed to update chat properties in search index"),
        EntityType::Project => opensearch_client
            .update_project_properties(entity_id, &properties().await?)
            .await
            .context("failed to update project properties in search index"),
        EntityType::CallRecord => opensearch_client
            .update_call_record_properties(entity_id, &properties().await?)
            .await
            .context("failed to update call record properties in search index"),
        EntityType::CalendarEvent => opensearch_client
            .update_calendar_event_properties(entity_id, &properties().await?)
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

/// Rewrite every document of an email thread under its lease, so the
/// properties ride with the version the thread's other writes carry.
async fn refresh_email_thread(
    email_indexer: &EmailIndexer,
    entity_id: &str,
    lease_pool: LeasePool,
) -> Result<PropertyRefresh, PropertyRefreshError> {
    let thread_id = Uuid::parse_str(entity_id).context("email thread id is not a uuid")?;
    let writes = email_indexer
        .reconcile_threads(&[thread_id], None, EmailWriter::Property, lease_pool)
        .await
        .map_err(PropertyRefreshError::EmailThread)?
        .writes;
    Ok(if writes.refused_stale > 0 {
        PropertyRefresh::RefusedStale
    } else if writes.indexed + writes.deleted > 0 {
        PropertyRefresh::Written
    } else {
        PropertyRefresh::NotIndexed
    })
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

#[cfg(test)]
mod test;
