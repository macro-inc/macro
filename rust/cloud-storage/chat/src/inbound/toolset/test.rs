use super::read_chat::ReadChat;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_read_chat_schema_validation() {
    let result = generate_validated_input_schema::<ReadChat>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ReadChat",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("chat"),
        "Description should contain expected text"
    );
}
