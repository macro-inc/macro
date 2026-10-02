use super::*;

#[test]
fn warnings_serialize_as_one_string_in_order() {
    let warnings = WriteWarnings(vec![
        WriteWarning::SchemaNotRefreshed {
            database_id: DATABASE_ID,
            cause: "The databases service failed.".into(),
        },
        WriteWarning::SchemaNotRefreshed {
            database_id: DATABASE_ID,
            cause: "Access could not be checked.".into(),
        },
    ]);

    assert_eq!(
        serde_json::to_value(&warnings).unwrap(),
        serde_json::json!(format!(
            "The change was saved, but its schema could not be refreshed: The databases \
             service failed. Call DescribeDatabase with databaseId {DATABASE_ID} before \
             continuing; do not repeat this successful mutation. The change was saved, but its \
             schema could not be refreshed: Access could not be checked. Call DescribeDatabase \
             with databaseId {DATABASE_ID} before continuing; do not repeat this successful \
             mutation."
        ))
    );
}
