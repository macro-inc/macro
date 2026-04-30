use super::read_chat::ReadChat;
use ai::generate_tool_input_schema;
use ai::tool::types::tool_object::validate_tool_schema;

#[test]
fn test_read_chat_schema_validation() {
    let schema = generate_tool_input_schema!(ReadChat);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ReadChat",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("chat"),
        "Description should contain expected text"
    );
}
