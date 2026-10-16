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

#[test]
fn test_call_mutation_schema_validation() {
    use super::{delete_call_record::DeleteCallRecord, update_call_record::UpdateCallRecord};

    let update = generate_validated_input_schema::<UpdateCallRecord>().expect("valid schema");
    assert_eq!(update.name, "UpdateCallRecord");
    let delete = generate_validated_input_schema::<DeleteCallRecord>().expect("valid schema");
    assert_eq!(delete.name, "DeleteCallRecord");
    assert!(delete.description.contains("cannot be undone"));
}
