use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use properties_db_client::error::PropertiesDatabaseError;
use sqlx::{Pool, Postgres};
use thiserror::Error;
use uuid::Uuid;

use crate::constants::{METADATA_PROPERTY_ID, metadata};

#[derive(Debug, Error)]
pub enum MetadataError {
    #[error("Document not found")]
    NotFound,

    #[error("An internal error occurred")]
    DatabaseError(#[from] PropertiesDatabaseError),
}

/// Get document metadata properties from macrodb
pub async fn get_document_metadata_properties(
    db: &Pool<Postgres>,
    document_id: &str,
    entity_type: EntityType,
) -> Result<Vec<EntityPropertyWithDefinition>, MetadataError> {
    tracing::info!("getting document metadata properties from macrodb");

    // Fetch document metadata from macrodb
    let document_metadata =
        properties_db_client::document_metadata::get::get_document_metadata(db, document_id)
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error = ?e,
                    document_id = %document_id,
                    "failed to get document metadata from database"
                );
            })?
            .ok_or(MetadataError::NotFound)?;

    tracing::debug!(
        document_id = %document_id,
        has_document_name = !document_metadata.name.is_empty(),
        has_owner = !document_metadata.owner.is_empty(),
        has_project_id = document_metadata.project_id.is_some(),
        "parsed document metadata"
    );

    let mut metadata_properties = Vec::new();

    // 1. Document name property
    let name = if document_metadata.name.is_empty() {
        None
    } else {
        Some(document_metadata.name)
    };
    metadata_properties.push(create_metadata_property_str(
        metadata::DOCUMENT_NAME,
        models_properties::DataType::String,
        name,
        entity_type,
    ));

    // 2. Owner property
    let owner = if document_metadata.owner.is_empty() {
        None
    } else {
        Some(EntityReference::new(
            document_metadata.owner,
            EntityType::User,
        ))
    };
    metadata_properties.push(create_metadata_property_entity_ref(
        metadata::OWNER,
        models_properties::DataType::Entity,
        owner,
        entity_type,
        Some(EntityType::User),
    ));

    // 3. Created time property
    metadata_properties.push(create_metadata_property_date(
        metadata::CREATED_AT,
        models_properties::DataType::Date,
        Some(document_metadata.created_at),
        entity_type,
    ));

    // 4. Last updated time property
    metadata_properties.push(create_metadata_property_date(
        metadata::LAST_UPDATED,
        models_properties::DataType::Date,
        Some(document_metadata.updated_at),
        entity_type,
    ));

    // 5. Project property
    let project = document_metadata
        .project_id
        .map(|id| EntityReference::new(id, EntityType::Project));
    metadata_properties.push(create_metadata_property_entity_ref(
        metadata::PROJECT,
        models_properties::DataType::Entity,
        project,
        entity_type,
        Some(EntityType::Project),
    ));

    tracing::debug!(
        document_id = %document_id,
        metadata_properties_count = metadata_properties.len(),
        "created document metadata properties"
    );

    Ok(metadata_properties)
}

/// Get thread metadata properties from macrodb
pub async fn get_thread_metadata_properties(
    db: &Pool<Postgres>,
    thread_id: Uuid,
) -> Result<Vec<EntityPropertyWithDefinition>, MetadataError> {
    tracing::info!("getting thread metadata properties from macrodb");

    let entity_type = EntityType::Thread;

    // Fetch thread metadata from macrodb
    let thread_metadata =
        properties_db_client::thread_metadata::get::get_thread_metadata(db, thread_id)
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error = ?e,
                    thread_id = %thread_id,
                    "failed to get thread metadata from database"
                );
            })?
            .ok_or(MetadataError::NotFound)?;

    tracing::debug!(
        thread_id = %thread_id,
        has_subject = thread_metadata.subject.is_some(),
        message_count = thread_metadata.message_count,
        "parsed thread metadata"
    );

    let metadata_properties = vec![
        // 1. Subject property
        create_metadata_property_str(
            metadata::SUBJECT,
            models_properties::DataType::String,
            thread_metadata.subject.clone(),
            entity_type,
        ),
        // 2. Thread Started property
        create_metadata_property_date(
            metadata::THREAD_STARTED,
            models_properties::DataType::Date,
            thread_metadata.thread_started,
            entity_type,
        ),
        // 3. Last Received property
        create_metadata_property_date(
            metadata::LAST_RECEIVED,
            models_properties::DataType::Date,
            thread_metadata.last_received,
            entity_type,
        ),
        // 4. Last Sent property
        create_metadata_property_date(
            metadata::LAST_SENT,
            models_properties::DataType::Date,
            thread_metadata.last_sent,
            entity_type,
        ),
        // 5. Messages property (count)
        create_metadata_property_number(
            metadata::MESSAGES,
            models_properties::DataType::Number,
            thread_metadata.message_count,
            entity_type,
        ),
    ];

    tracing::debug!(
        thread_id = %thread_id,
        metadata_properties_count = metadata_properties.len(),
        "created thread metadata properties"
    );

    Ok(metadata_properties)
}

// ===== Metadata Property Helpers =====
//
// These helpers create read-only metadata properties that are computed on-the-fly
// from entity data (not stored in the properties tables). They share a special
// METADATA_PROPERTY_ID and are marked with is_metadata=true.

/// Create a metadata property with a string value (e.g., document name, subject)
pub fn create_metadata_property_str(
    display_name: &str,
    data_type: models_properties::DataType,
    value: Option<String>,
    entity_type: EntityType,
) -> EntityPropertyWithDefinition {
    let property_value = value.map(PropertyValue::Str);
    create_metadata_property_inner(display_name, data_type, property_value, entity_type, None)
}

/// Create a metadata property with a date/timestamp value (e.g., created_at, last_updated)
pub fn create_metadata_property_date(
    display_name: &str,
    data_type: models_properties::DataType,
    value: Option<chrono::DateTime<chrono::Utc>>,
    entity_type: EntityType,
) -> EntityPropertyWithDefinition {
    let property_value = value.map(PropertyValue::Date);
    create_metadata_property_inner(display_name, data_type, property_value, entity_type, None)
}

/// Create a metadata property with a numeric value (e.g., message count)
pub fn create_metadata_property_number(
    display_name: &str,
    data_type: models_properties::DataType,
    value: i64,
    entity_type: EntityType,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::Num(value as f64);
    create_metadata_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        None,
    )
}

/// Create a metadata property with an entity reference value (e.g., owner, project)
pub fn create_metadata_property_entity_ref(
    display_name: &str,
    data_type: models_properties::DataType,
    value: Option<EntityReference>,
    entity_type: EntityType,
    specific_entity_type: Option<EntityType>,
) -> EntityPropertyWithDefinition {
    let property_value = value.map(|v| PropertyValue::EntityRef(vec![v]));
    create_metadata_property_inner(
        display_name,
        data_type,
        property_value,
        entity_type,
        specific_entity_type,
    )
}

/// Internal helper that constructs the EntityPropertyWithDefinition struct.
/// Sets up the property definition with METADATA_PROPERTY_ID and is_metadata=true.
fn create_metadata_property_inner(
    display_name: &str,
    data_type: models_properties::DataType,
    value: Option<PropertyValue>,
    entity_type: EntityType,
    specific_entity_type: Option<EntityType>,
) -> EntityPropertyWithDefinition {
    // Metadata properties are computed on-the-fly and never persisted
    // Use System owner since they don't belong to any user or org
    let owner = models_properties::PropertyOwner::System;

    let property_definition = PropertyDefinition {
        id: METADATA_PROPERTY_ID,
        owner,
        display_name: display_name.to_string(),
        data_type,
        is_multi_select: false,
        specific_entity_type,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        is_system: false, // Metadata properties are not DB-stored system properties
        is_metadata: true,
    };

    let entity_property = EntityProperty {
        id: METADATA_PROPERTY_ID,
        entity_id: "".to_string(), // Will be set by caller
        entity_type,
        property_definition_id: METADATA_PROPERTY_ID,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    EntityPropertyWithDefinition {
        property: entity_property,
        definition: property_definition,
        value,
        options: None,
    }
}
