use super::list_call_records::ListCallRecords;
use super::read_call_record::ReadCallRecord;
use ai_toolset::generate_tool_input_schema;
use ai_toolset::tool_object::validate_tool_schema;

#[test]
fn test_list_call_records_schema_validation() {
    let schema = generate_tool_input_schema!(ListCallRecords);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ListCallRecords",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("List"),
        "Description should contain expected text"
    );
}

#[test]
fn test_read_call_record_schema_validation() {
    let schema = generate_tool_input_schema!(ReadCallRecord);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ReadCallRecord",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("transcript"),
        "Description should contain expected text"
    );
}
