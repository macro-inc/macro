use super::read_call_record::ReadCallRecord;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_read_call_record_schema_validation() {
    let result = generate_validated_input_schema::<ReadCallRecord>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ReadCallRecord",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("transcript"),
        "Description should contain expected text"
    );
}
