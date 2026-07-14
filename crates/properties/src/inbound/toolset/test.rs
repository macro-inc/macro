#[allow(unused_imports)]
use super::*;
use ai_toolset::schema::generate_validated_input_schema;

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
