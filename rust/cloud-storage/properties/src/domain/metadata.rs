//! Read-only metadata properties computed on-the-fly from entity data.
//!
//! These are never persisted in the properties tables: they surface fields of
//! the entity itself (name, owner, timestamps, ...) in the property response
//! shape. They share a special [`METADATA_PROPERTY_ID`] and are marked with
//! `is_metadata = true`.

use models_properties::service::document_metadata::DocumentMetadata;
use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::project_metadata::ProjectMetadata;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::service::thread_metadata::ThreadMetadata;
use models_properties::{EntityReference, EntityType};
use uuid::Uuid;

/// Special UUID used for system-generated metadata properties.
/// This distinguishes metadata properties from user-created properties.
pub const METADATA_PROPERTY_ID: Uuid = Uuid::from_u128(0xFFFFFFFF_FFFF_FFFF_FFFF_FFFFFFFFFFFF);

/// Metadata property display names
pub mod display_names {
    // Common (shared across entity types)
    pub const OWNER: &str = "Owner";
    pub const CREATED_AT: &str = "Created At";
    pub const LAST_UPDATED: &str = "Last Updated";

    // Document metadata
    pub const DOCUMENT_NAME: &str = "Document Name";
    pub const DOCUMENT_PROJECT: &str = "Project";

    // Thread metadata
    pub const THREAD_SUBJECT: &str = "Subject";
    pub const THREAD_STARTED: &str = "Thread Started";
    pub const THREAD_LAST_RECEIVED: &str = "Last Received";
    pub const THREAD_LAST_SENT: &str = "Last Sent";
    pub const THREAD_MESSAGES: &str = "Messages";

    // Project metadata
    pub const PROJECT_NAME: &str = "Project Name";
    pub const PROJECT_PARENT: &str = "Parent Project";
}

/// Build the metadata properties for a document (or task, which is stored as a document).
pub fn document_metadata_properties(
    document_metadata: DocumentMetadata,
    entity_type: EntityType,
) -> Vec<EntityPropertyWithDefinition> {
    let mut metadata_properties = Vec::new();

    // 1. Document name property
    let name = (!document_metadata.name.is_empty()).then_some(document_metadata.name);
    metadata_properties.push(create_metadata_property_str(
        display_names::DOCUMENT_NAME,
        models_properties::DataType::String,
        name,
        entity_type,
    ));

    // 2. Owner property
    let owner = (!document_metadata.owner.is_empty())
        .then(|| EntityReference::new(document_metadata.owner, EntityType::User));
    metadata_properties.push(create_metadata_property_entity_ref(
        display_names::OWNER,
        models_properties::DataType::Entity,
        owner,
        entity_type,
        Some(EntityType::User),
    ));

    // 3. Created time property
    metadata_properties.push(create_metadata_property_date(
        display_names::CREATED_AT,
        models_properties::DataType::Date,
        Some(document_metadata.created_at),
        entity_type,
    ));

    // 4. Last updated time property
    metadata_properties.push(create_metadata_property_date(
        display_names::LAST_UPDATED,
        models_properties::DataType::Date,
        Some(document_metadata.updated_at),
        entity_type,
    ));

    // 5. Project property
    let project = document_metadata
        .project_id
        .map(|id| EntityReference::new(id, EntityType::Project));
    metadata_properties.push(create_metadata_property_entity_ref(
        display_names::DOCUMENT_PROJECT,
        models_properties::DataType::Entity,
        project,
        entity_type,
        Some(EntityType::Project),
    ));

    metadata_properties
}

/// Build the metadata properties for an email thread.
pub fn thread_metadata_properties(
    thread_metadata: ThreadMetadata,
) -> Vec<EntityPropertyWithDefinition> {
    let entity_type = EntityType::Thread;

    vec![
        // 1. Subject property
        create_metadata_property_str(
            display_names::THREAD_SUBJECT,
            models_properties::DataType::String,
            thread_metadata.subject.clone(),
            entity_type,
        ),
        // 2. Thread Started property
        create_metadata_property_date(
            display_names::THREAD_STARTED,
            models_properties::DataType::Date,
            thread_metadata.thread_started,
            entity_type,
        ),
        // 3. Last Received property
        create_metadata_property_date(
            display_names::THREAD_LAST_RECEIVED,
            models_properties::DataType::Date,
            thread_metadata.last_received,
            entity_type,
        ),
        // 4. Last Sent property
        create_metadata_property_date(
            display_names::THREAD_LAST_SENT,
            models_properties::DataType::Date,
            thread_metadata.last_sent,
            entity_type,
        ),
        // 5. Messages property (count)
        create_metadata_property_number(
            display_names::THREAD_MESSAGES,
            models_properties::DataType::Number,
            thread_metadata.message_count,
            entity_type,
        ),
    ]
}

/// Build the metadata properties for a project.
pub fn project_metadata_properties(
    project_metadata: ProjectMetadata,
) -> Vec<EntityPropertyWithDefinition> {
    let entity_type = EntityType::Project;

    // 1. Project name property
    let name = (!project_metadata.name.is_empty()).then_some(project_metadata.name);

    // 2. Owner property
    let owner = (!project_metadata.owner.is_empty())
        .then(|| EntityReference::new(project_metadata.owner, EntityType::User));

    // 5. Parent project property
    let parent = project_metadata
        .parent_id
        .map(|id| EntityReference::new(id, EntityType::Project));

    vec![
        create_metadata_property_str(
            display_names::PROJECT_NAME,
            models_properties::DataType::String,
            name,
            entity_type,
        ),
        create_metadata_property_entity_ref(
            display_names::OWNER,
            models_properties::DataType::Entity,
            owner,
            entity_type,
            Some(EntityType::User),
        ),
        // 3. Created time property
        create_metadata_property_date(
            display_names::CREATED_AT,
            models_properties::DataType::Date,
            Some(project_metadata.created_at),
            entity_type,
        ),
        // 4. Last updated time property
        create_metadata_property_date(
            display_names::LAST_UPDATED,
            models_properties::DataType::Date,
            Some(project_metadata.updated_at),
            entity_type,
        ),
        create_metadata_property_entity_ref(
            display_names::PROJECT_PARENT,
            models_properties::DataType::Entity,
            parent,
            entity_type,
            Some(EntityType::Project),
        ),
    ]
}

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
