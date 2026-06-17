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
