use super::*;
use chrono::Utc;
use models_properties::PropertyOwner;

#[test]
fn descriptor_uses_declared_source_cardinality() {
    let multi_select = ImportedPropertyDescriptor::of(&ImportedDocumentPropertyValue::Select {
        values: vec!["Planning".to_string()],
        multi: true,
    });
    assert_eq!(multi_select.stored_type, DataType::SelectString);
    assert!(multi_select.is_multi_select);
    assert_eq!(
        multi_select.definition_type,
        PropertyDataType::SelectString {
            options: Vec::new(),
            multi: true,
        }
    );

    let single_link = ImportedPropertyDescriptor::of(&ImportedDocumentPropertyValue::Link {
        urls: vec![
            "https://notion.so/roadmap".to_string(),
            "https://notion.so/spec".to_string(),
        ],
        multi: false,
    });
    assert_eq!(single_link.stored_type, DataType::Link);
    assert!(!single_link.is_multi_select);
    assert_eq!(
        single_link.definition_type,
        PropertyDataType::Link { multi: false }
    );
}

#[test]
fn resolver_prefers_compatible_system_definition_after_incompatible_custom_definition() {
    let mut incompatible_custom = system_definition();
    incompatible_custom.id = Uuid::from_u128(1);
    incompatible_custom.owner = PropertyOwner::User {
        user_id: "macro|import-test@example.com".to_string(),
    };
    incompatible_custom.data_type = DataType::String;
    incompatible_custom.is_system = false;

    let compatible_system = system_definition();
    let definitions = vec![incompatible_custom, compatible_system.clone()];
    let property = select_property();
    let descriptor = ImportedPropertyDescriptor::of(&property.value);

    let resolution = resolve_existing_definition(
        &property.name,
        &descriptor,
        &definitions,
        std::slice::from_ref(&compatible_system),
    );
    let ExistingDefinitionResolution::Reuse(resolved) = resolution else {
        panic!("compatible system definition should be reused");
    };

    assert_eq!(resolved.id, compatible_system.id);
    assert!(resolved.is_system);
}

#[test]
fn resolver_rejects_incompatible_reserved_system_definition() {
    let system_definition = system_definition();
    let property = ImportedDocumentProperty {
        name: "status".to_string(),
        value: ImportedDocumentPropertyValue::String {
            value: "In Progress".to_string(),
        },
    };
    let descriptor = ImportedPropertyDescriptor::of(&property.value);

    let resolution = resolve_existing_definition(
        &property.name,
        &descriptor,
        &[],
        std::slice::from_ref(&system_definition),
    );

    assert!(matches!(
        resolution,
        ExistingDefinitionResolution::Conflict(DefinitionConflict::ReservedSystem {
            definition_id
        })
            if definition_id == system_definition.id
    ));
}

#[test]
fn resolver_allows_creation_for_unreserved_name() {
    let property = ImportedDocumentProperty {
        name: "Priority".to_string(),
        value: ImportedDocumentPropertyValue::String {
            value: "High".to_string(),
        },
    };
    let descriptor = ImportedPropertyDescriptor::of(&property.value);

    let resolution = resolve_existing_definition(&property.name, &descriptor, &[], &[]);

    assert!(matches!(resolution, ExistingDefinitionResolution::Create));
}

fn select_property() -> ImportedDocumentProperty {
    ImportedDocumentProperty {
        name: "status".to_string(),
        value: ImportedDocumentPropertyValue::Select {
            values: vec!["In Progress".to_string()],
            multi: false,
        },
    }
}

fn system_definition() -> PropertyDefinition {
    PropertyDefinition {
        id: Uuid::from_u128(2),
        owner: PropertyOwner::System,
        display_name: "Status".to_string(),
        data_type: DataType::SelectString,
        is_multi_select: false,
        specific_entity_type: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        is_system: true,
        is_metadata: false,
    }
}
