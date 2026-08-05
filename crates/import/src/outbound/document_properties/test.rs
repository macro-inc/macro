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

#[tokio::test]
async fn resolver_prefers_compatible_system_definition_after_incompatible_custom_definition() {
    let mut incompatible_custom = system_definition();
    incompatible_custom.id = Uuid::from_u128(1);
    incompatible_custom.owner = PropertyOwner::User {
        user_id: user().to_string(),
    };
    incompatible_custom.data_type = DataType::String;
    incompatible_custom.is_system = false;

    let compatible_system = system_definition();
    let mut definitions = vec![incompatible_custom, compatible_system.clone()];
    let property = select_property();
    let descriptor = ImportedPropertyDescriptor::of(&property.value);

    let resolved = find_or_create_definition(
        &TestPropertiesService,
        &user(),
        "document-id",
        &property,
        &descriptor,
        &mut definitions,
        std::slice::from_ref(&compatible_system),
    )
    .await
    .expect("compatible system definition should be reused");

    assert_eq!(resolved.id, compatible_system.id);
    assert!(resolved.is_system);
    assert_eq!(definitions.len(), 2);
}

#[tokio::test]
async fn resolver_rejects_incompatible_reserved_system_definition_without_creating() {
    let system_definition = system_definition();
    let property = ImportedDocumentProperty {
        name: "status".to_string(),
        value: ImportedDocumentPropertyValue::String {
            value: "In Progress".to_string(),
        },
    };
    let descriptor = ImportedPropertyDescriptor::of(&property.value);
    let mut definitions = Vec::new();

    let resolved = find_or_create_definition(
        &TestPropertiesService,
        &user(),
        "document-id",
        &property,
        &descriptor,
        &mut definitions,
        std::slice::from_ref(&system_definition),
    )
    .await;

    assert!(resolved.is_none());
    assert!(definitions.is_empty());
}

struct TestPropertiesService;

#[async_trait::async_trait]
impl ImportedPropertyDefinitions for TestPropertiesService {
    type Error = std::convert::Infallible;

    async fn create_imported_definition(
        &self,
        _user: &MacroUserIdStr<'_>,
        _request: &CreatePropertyDefinitionRequest,
    ) -> Result<PropertyDefinition, Self::Error> {
        panic!("resolver should not create a property definition")
    }

    async fn list_imported_definitions(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<PropertyDefinition>, Self::Error> {
        panic!("resolver should not reload property definitions")
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|import-test@example.com").expect("valid user id")
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
