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
fn system_definition_is_reused_when_name_and_type_match() {
    let definition = system_definition();
    let definitions = vec![definition];
    let descriptor = ImportedPropertyDescriptor::of(&ImportedDocumentPropertyValue::Select {
        values: vec!["In Progress".to_string()],
        multi: false,
    });

    let matched = find_definition_by_name(&definitions, "status").unwrap();
    assert!(matched.is_system);
    assert!(descriptor.matches(matched));
}

#[test]
fn system_definition_with_incompatible_type_is_not_reusable() {
    let definition = system_definition();
    let descriptor = ImportedPropertyDescriptor::of(&ImportedDocumentPropertyValue::String {
        value: "In Progress".to_string(),
    });

    assert!(!descriptor.matches(&definition));
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
