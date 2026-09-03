#[allow(unused_imports)]
use super::*;
use ai_toolset::schema::generate_validated_input_schema;
use models_properties::api::{CreatePropertyScope, PropertyDataType};

#[test]
fn test_get_entity_properties_schema_validation() {
    let result = generate_validated_input_schema::<GetEntityProperties>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "GetEntityProperties");
    assert!(
        validated.description.contains("Get all properties"),
        "Description should contain expected text"
    );
}

#[test]
fn test_set_entity_property_schema_validation() {
    let result = generate_validated_input_schema::<SetEntityProperty>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "SetEntityProperty");
    assert!(
        validated.description.contains("Set or update a property"),
        "Description should contain expected text"
    );
}

#[test]
fn test_set_entity_property_schema_documents_delta_options() {
    let validated = generate_validated_input_schema::<SetEntityProperty>().unwrap();
    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("add_option_ids"),
        "schema should expose add_option_ids"
    );
    assert!(
        schema_json.contains("remove_option_ids"),
        "schema should expose remove_option_ids"
    );
    assert!(
        validated.description.contains("atomically"),
        "description should steer to atomic add/remove over full replace"
    );
}

#[test]
fn test_bulk_set_entity_property_options_schema_validation() {
    let result = generate_validated_input_schema::<BulkSetEntityPropertyOptions>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "BulkSetEntityPropertyOptions");
    assert!(
        validated.description.contains("many entities"),
        "Description should explain the multi-entity apply"
    );

    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("entities")
            && schema_json.contains("add_option_ids")
            && schema_json.contains("remove_option_ids"),
        "schema should expose entities and the add/remove option deltas"
    );
}

#[test]
fn test_list_tags_schema_validation() {
    let result = generate_validated_input_schema::<ListTags>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "ListTags");
    assert!(
        validated.description.contains("personal tag set"),
        "Description should explain the personal/team tag sets"
    );
    assert!(
        validated.description.contains("SetEntityProperty"),
        "Description should point at SetEntityProperty for applying tags"
    );
}

#[test]
fn test_create_custom_property_schema_validation() {
    let result = generate_validated_input_schema::<CreateCustomProperty>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "CreateCustomProperty");
    assert!(
        validated
            .description
            .contains("Create a new custom property"),
        "Description should explain that it creates a custom property"
    );
    assert!(
        validated.description.contains("CreateTag"),
        "Description should distinguish custom properties from tags"
    );

    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("display_name") && schema_json.contains("data_type"),
        "schema should expose display_name and data_type"
    );
    assert!(
        schema_json.contains("scope") && schema_json.contains("options"),
        "schema should expose scope and options"
    );
    assert!(
        schema_json.contains("select") && schema_json.contains("entity"),
        "schema should expose select and entity data types"
    );
    assert!(
        schema_json.contains("numeric string"),
        "schema should describe select_number options as numeric strings"
    );
}

#[test]
fn test_create_custom_property_select_maps_options() {
    let tool = CreateCustomProperty {
        display_name: "  Department  ".to_string(),
        data_type: super::create_custom_property::ToolPropertyDataType::Select,
        scope: CreatePropertyScope::Team,
        options: vec!["Engineering".into(), " Sales ".into(), "".into()],
        multi: true,
        referenced_entity_type: None,
    };
    let request = tool.to_create_request().expect("valid select request");
    assert_eq!(request.display_name, "Department");
    assert_eq!(request.scope, CreatePropertyScope::Team);
    match request.data_type {
        PropertyDataType::SelectString { options, multi } => {
            assert!(multi);
            assert_eq!(
                options
                    .iter()
                    .map(|o| (o.display_order, o.value.as_str()))
                    .collect::<Vec<_>>(),
                vec![(0, "Engineering"), (1, "Sales")]
            );
        }
        other => panic!("expected select_string, got {other:?}"),
    }
}

#[test]
fn test_create_custom_property_select_requires_options() {
    let tool = CreateCustomProperty {
        display_name: "Department".to_string(),
        data_type: super::create_custom_property::ToolPropertyDataType::Select,
        scope: CreatePropertyScope::Team,
        options: vec![],
        multi: false,
        referenced_entity_type: None,
    };
    let err = tool.to_create_request().expect_err("select needs options");
    assert!(
        err.description.contains("at least one choice"),
        "unexpected error: {}",
        err.description
    );
}

#[test]
fn test_create_custom_property_rejects_options_on_string() {
    let tool = CreateCustomProperty {
        display_name: "Notes".to_string(),
        data_type: super::create_custom_property::ToolPropertyDataType::String,
        scope: CreatePropertyScope::User,
        options: vec!["nope".into()],
        multi: false,
        referenced_entity_type: None,
    };
    let err = tool
        .to_create_request()
        .expect_err("string rejects options");
    assert!(
        err.description.contains("only valid for select"),
        "unexpected error: {}",
        err.description
    );
}

#[test]
fn test_create_custom_property_rejects_multi_on_string() {
    let tool = CreateCustomProperty {
        display_name: "Notes".to_string(),
        data_type: super::create_custom_property::ToolPropertyDataType::String,
        scope: CreatePropertyScope::User,
        options: vec![],
        multi: true,
        referenced_entity_type: None,
    };
    let err = tool.to_create_request().expect_err("string rejects multi");
    assert!(
        err.description.contains("`multi` is only valid"),
        "unexpected error: {}",
        err.description
    );
}

#[test]
fn test_create_custom_property_select_number_parses_numeric_strings() {
    let tool = CreateCustomProperty {
        display_name: "Priority".to_string(),
        data_type: super::create_custom_property::ToolPropertyDataType::SelectNumber,
        scope: CreatePropertyScope::User,
        options: vec!["1".into(), "2.5".into()],
        multi: false,
        referenced_entity_type: None,
    };
    let request = tool
        .to_create_request()
        .expect("valid select_number request");
    match request.data_type {
        PropertyDataType::SelectNumber { options, .. } => {
            assert_eq!(
                options
                    .iter()
                    .map(|o| (o.display_order, o.value))
                    .collect::<Vec<_>>(),
                vec![(0, 1.0), (1, 2.5)]
            );
        }
        other => panic!("expected select_number, got {other:?}"),
    }

    let tool = CreateCustomProperty {
        options: vec!["high".into()],
        ..tool
    };
    let err = tool
        .to_create_request()
        .expect_err("non-numeric select_number option");
    assert!(
        err.description.contains("numeric strings"),
        "unexpected error: {}",
        err.description
    );
}

#[test]
fn test_create_custom_property_entity_maps_referenced_type() {
    let tool = CreateCustomProperty {
        display_name: "Owner".to_string(),
        data_type: super::create_custom_property::ToolPropertyDataType::Entity,
        scope: CreatePropertyScope::Team,
        options: vec![],
        multi: false,
        referenced_entity_type: Some(super::get_entity_properties::ToolEntityType::User),
    };
    let request = tool.to_create_request().expect("valid entity request");
    match request.data_type {
        PropertyDataType::Entity {
            specific_type,
            multi,
        } => {
            assert!(!multi);
            assert_eq!(specific_type, Some(models_properties::EntityType::User));
        }
        other => panic!("expected entity, got {other:?}"),
    }
}

#[test]
fn test_create_tag_schema_validation() {
    let result = generate_validated_input_schema::<CreateTag>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "CreateTag");
    assert!(
        validated.description.contains("Create a new tag"),
        "Description should explain that it creates a new tag"
    );

    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("label") && schema_json.contains("color"),
        "schema should expose label and color"
    );
    assert!(
        schema_json.contains("scope"),
        "schema should expose the personal/team scope"
    );
}

#[test]
fn test_edit_tag_schema_validation() {
    let result = generate_validated_input_schema::<EditTag>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "EditTag");
    assert!(
        validated.description.contains("Rename or recolor"),
        "Description should explain rename/recolor"
    );

    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("label") && schema_json.contains("color"),
        "schema should expose label and color"
    );
    assert!(
        schema_json.contains("property_definition_id"),
        "schema should require the tag set's property_definition_id"
    );
}

#[test]
fn test_delete_tag_schema_validation() {
    let result = generate_validated_input_schema::<DeleteTag>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(validated.name, "DeleteTag");
    assert!(
        validated.description.contains("Permanently delete a tag"),
        "Description should explain the destructive delete"
    );

    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("property_definition_id"),
        "schema should require the tag set's property_definition_id"
    );
}

// run `cargo test -p properties inbound::toolset::test::print_get_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_get_input_schema() {
    let schema = generate_validated_input_schema::<GetEntityProperties>()
        .unwrap()
        .schema;
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p properties inbound::toolset::test::print_set_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_set_input_schema() {
    let schema = generate_validated_input_schema::<SetEntityProperty>()
        .unwrap()
        .schema;
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p properties inbound::toolset::test::print_get_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_get_output_schema() {
    let schema = schemars::schema_for!(GetEntityPropertiesResponse);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p properties inbound::toolset::test::print_set_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_set_output_schema() {
    let schema = schemars::schema_for!(SetEntityPropertyResponse);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
