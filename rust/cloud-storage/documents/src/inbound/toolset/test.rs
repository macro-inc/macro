use super::*;
use ai::generate_tool_input_schema;
use ai::tool::types::tool_object::validate_tool_schema;

#[test]
fn test_read_metadata_schema_validation() {
    let schema = generate_tool_input_schema!(ReadMetadata);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ReadMetadata",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("Retrieve"),
        "Description should contain expected text"
    );
}

#[test]
fn test_read_content_schema_validation() {
    let schema = generate_tool_input_schema!(ReadContent);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ReadContent",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("Retrieve"),
        "Description should contain expected text"
    );
}
