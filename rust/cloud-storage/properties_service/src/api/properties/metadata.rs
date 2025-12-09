use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use properties_db_client::error::PropertiesDatabaseError;
use sqlx::{Pool, Postgres};
use thiserror::Error;

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
    if !document_metadata.name.is_empty() {
        metadata_properties.push(create_metadata_property_str(
            metadata::DOCUMENT_NAME,
            models_properties::DataType::String,
            document_metadata.name,
            entity_type,
        ));
    }

    // 2. Owner property
    if !document_metadata.owner.is_empty() {
        let owner_entity_ref = EntityReference {
            entity_id: document_metadata.owner,
            entity_type: EntityType::User,
        };
        metadata_properties.push(create_metadata_property_entity_ref(
            metadata::OWNER,
            models_properties::DataType::Entity,
            owner_entity_ref,
            entity_type,
            Some(EntityType::User),
        ));
    }

    // 3. Created time property
    metadata_properties.push(create_metadata_property_date(
        metadata::CREATED_AT,
        models_properties::DataType::Date,
        document_metadata.created_at,
        entity_type,
    ));

    // 4. Last updated time property
    metadata_properties.push(create_metadata_property_date(
        metadata::LAST_UPDATED,
        models_properties::DataType::Date,
        document_metadata.updated_at,
        entity_type,
    ));

    // 5. Project property
    if let Some(project_id) = document_metadata.project_id {
        let project_entity_ref = EntityReference {
            entity_id: project_id,
            entity_type: EntityType::Project,
        };
        metadata_properties.push(create_metadata_property_entity_ref(
            metadata::PROJECT,
            models_properties::DataType::Entity,
            project_entity_ref,
            entity_type,
            Some(EntityType::Project),
        ));
    } else {
        // Add project property with null value
        metadata_properties.push(create_metadata_property_null(
            metadata::PROJECT,
            models_properties::DataType::Entity,
            entity_type,
            Some(EntityType::Project),
        ));
    }

    tracing::debug!(
        document_id = %document_id,
        metadata_properties_count = metadata_properties.len(),
        "created document metadata properties"
    );

    Ok(metadata_properties)
}

/// Create a metadata property with a string value
pub fn create_metadata_property_str(
    display_name: &str,
    data_type: models_properties::DataType,
    value: String,
    entity_type: EntityType,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::Str(value);
    create_metadata_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        None,
    )
}

pub fn create_metadata_property_date(
    display_name: &str,
    data_type: models_properties::DataType,
    value: chrono::DateTime<chrono::Utc>,
    entity_type: EntityType,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::Date(value);
    create_metadata_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        None,
    )
}

pub fn create_metadata_property_entity_ref(
    display_name: &str,
    data_type: models_properties::DataType,
    value: EntityReference,
    entity_type: EntityType,
    specific_entity_type: Option<EntityType>,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::EntityRef(vec![value]);
    create_metadata_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        specific_entity_type,
    )
}

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

/// Create a metadata property with null/empty value
pub fn create_metadata_property_null(
    property_name: &str,
    data_type: models_properties::DataType,
    entity_type: EntityType,
    specific_entity_type: Option<EntityType>,
) -> EntityPropertyWithDefinition {
    create_metadata_property_inner(
        property_name,
        data_type,
        None,
        entity_type,
        specific_entity_type,
    )
}
