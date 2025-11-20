//! Metadata properties support - system-generated properties for entities

use crate::constants::{METADATA_PROPERTY_ID, metadata};
use crate::domain::models::EntityPropertyWithDefinition;
use models_properties::service::entity_property::EntityProperty;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use sqlx::PgPool;

/// Get document metadata properties from macrodb
pub async fn get_document_metadata_properties(
    db: &PgPool,
    document_id: &str,
) -> Result<Vec<EntityPropertyWithDefinition>, sqlx::Error> {
    tracing::info!("getting document metadata properties from macrodb");

    // Fetch document metadata from macrodb
    let row = sqlx::query!(
        r#"
        SELECT
            d.id,
            d.name,
            d.owner,
            d."createdAt"::timestamptz as created_at,
            d."updatedAt"::timestamptz as updated_at,
            d."projectId" as project_id
        FROM "Document" d
        WHERE d.id = $1 AND d."deletedAt" IS NULL
        "#,
        document_id,
    )
    .fetch_optional(db)
    .await?;

    let doc = match row {
        Some(row) => row,
        None => {
            tracing::warn!(
                document_id = %document_id,
                "document not found in database"
            );
            return Ok(vec![]);
        }
    };

    tracing::debug!(
        document_id = %document_id,
        has_document_name = !doc.name.is_empty(),
        has_owner = !doc.owner.is_empty(),
        has_project_id = doc.project_id.is_some(),
        "parsed document metadata"
    );

    let mut metadata_properties = Vec::new();

    // 1. Document name property
    if !doc.name.is_empty() {
        metadata_properties.push(create_system_property_str(
            metadata::DOCUMENT_NAME,
            models_properties::shared::DataType::String,
            doc.name,
            EntityType::Document,
            document_id,
        ));
    }

    // 2. Owner property
    if !doc.owner.is_empty() {
        let owner_entity_ref = EntityReference {
            entity_id: doc.owner,
            entity_type: EntityType::User,
        };
        metadata_properties.push(create_system_property_entity_ref(
            metadata::OWNER,
            models_properties::shared::DataType::Entity,
            owner_entity_ref,
            EntityType::Document,
            document_id,
        ));
    }

    // 3. Created time property
    if let Some(created_at) = doc.created_at {
        metadata_properties.push(create_system_property_date(
            metadata::CREATED_AT,
            models_properties::shared::DataType::Date,
            created_at,
            EntityType::Document,
            document_id,
        ));
    }

    // 4. Last updated time property
    if let Some(updated_at) = doc.updated_at {
        metadata_properties.push(create_system_property_date(
            metadata::LAST_UPDATED,
            models_properties::shared::DataType::Date,
            updated_at,
            EntityType::Document,
            document_id,
        ));
    }

    // 5. Project property
    if let Some(project_id) = doc.project_id {
        let project_entity_ref = EntityReference {
            entity_id: project_id,
            entity_type: EntityType::Project,
        };
        metadata_properties.push(create_system_property_entity_ref(
            metadata::PROJECT,
            models_properties::shared::DataType::Entity,
            project_entity_ref,
            EntityType::Document,
            document_id,
        ));
    } else {
        // Add project property with null value
        metadata_properties.push(create_system_property_null(
            metadata::PROJECT,
            models_properties::shared::DataType::Entity,
            EntityType::Document,
            document_id,
        ));
    }

    tracing::debug!(
        document_id = %document_id,
        metadata_properties_count = metadata_properties.len(),
        "created document system properties"
    );

    Ok(metadata_properties)
}

/// Create a system property with a string value
fn create_system_property_str(
    display_name: &str,
    data_type: models_properties::shared::DataType,
    value: String,
    entity_type: EntityType,
    entity_id: &str,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::Str(value);
    create_system_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        entity_id,
    )
}

/// Create a system property with a date value
fn create_system_property_date(
    display_name: &str,
    data_type: models_properties::shared::DataType,
    value: chrono::DateTime<chrono::Utc>,
    entity_type: EntityType,
    entity_id: &str,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::Date(value);
    create_system_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        entity_id,
    )
}

/// Create a system property with an entity reference value
fn create_system_property_entity_ref(
    display_name: &str,
    data_type: models_properties::shared::DataType,
    value: EntityReference,
    entity_type: EntityType,
    entity_id: &str,
) -> EntityPropertyWithDefinition {
    let property_value = PropertyValue::EntityRef(vec![value]);
    create_system_property_inner(
        display_name,
        data_type,
        Some(property_value),
        entity_type,
        entity_id,
    )
}

/// Helper function to create a system property with null/empty value
fn create_system_property_null(
    property_name: &str,
    data_type: models_properties::shared::DataType,
    entity_type: EntityType,
    entity_id: &str,
) -> EntityPropertyWithDefinition {
    create_system_property_inner(property_name, data_type, None, entity_type, entity_id)
}

/// Internal helper to create system properties
fn create_system_property_inner(
    display_name: &str,
    data_type: models_properties::shared::DataType,
    value: Option<PropertyValue>,
    entity_type: EntityType,
    entity_id: &str,
) -> EntityPropertyWithDefinition {
    // System properties don't have a real owner, use a placeholder
    // These are computed on-the-fly and never persisted
    let owner = models_properties::shared::PropertyOwner::User {
        user_id: String::new(),
    };

    let property_definition = PropertyDefinition {
        id: METADATA_PROPERTY_ID,
        owner,
        display_name: display_name.to_string(),
        data_type,
        is_multi_select: false,
        specific_entity_type: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        is_metadata: true,
    };

    let entity_property = EntityProperty {
        id: METADATA_PROPERTY_ID,
        entity_id: entity_id.to_string(),
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
