use super::*;
use ai_toolset::generate_tool_input_schema;
use ai_toolset::tool_object::validate_tool_schema;

#[test]
fn test_list_channels_schema_validation() {
    let schema = generate_tool_input_schema!(ListChannels);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ListChannels",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("List all chat channels"),
        "Description should contain expected text"
    );
}

// run `cargo test -p ai_tools list::channel::test::print_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_input_schema() {
    let schema = generate_tool_input_schema!(ListChannels);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p ai_tools list::channel::test::print_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_output_schema() {
    let generator = ai_toolset::tool_object::minimized_output_schema_generator();
    let schema = generator.into_root_schema_for::<ListChannelsResponse>();
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
