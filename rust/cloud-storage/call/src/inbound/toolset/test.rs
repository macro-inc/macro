use super::list_call_records::{ListCallRecords, build_filter};
use super::read_call_record::ReadCallRecord;
use ai_toolset::schema::generate_validated_input_schema;
use filter_ast::Expr;
use item_filters::{CallStatus, ast::call::CallLiteral};
use serde_json::Value;

#[test]
fn test_list_call_records_schema_validation() {
    let result = generate_validated_input_schema::<ListCallRecords>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ListCallRecords",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("List"),
        "Description should contain expected text"
    );

    let schema_json =
        serde_json::to_value(&validated.schema).expect("schema should serialize to JSON");
    let status_schema = schema_property(&schema_json, "status");
    let status_values = find_enum_values(status_schema)
        .expect("status schema should include supported enum values");
    assert_eq!(
        status_values,
        vec![
            "ATTENDED".to_string(),
            "MISSED".to_string(),
            "UNATTENDED".to_string(),
        ]
    );

    let attended_schema = schema_property(&schema_json, "attended");
    let attended_description = attended_schema
        .get("description")
        .and_then(Value::as_str)
        .expect("attended schema should include a description");
    assert!(
        attended_description.contains("Deprecated"),
        "attended should remain documented as deprecated compatibility"
    );
}

#[test]
fn test_list_call_records_status_filter_preferred_over_attended() {
    let filter = build_filter(None, Some(CallStatus::Missed), Some(true));
    let expr = filter.expect("status should produce a filter");

    assert!(matches!(
        expr.as_ref(),
        Expr::Literal(CallLiteral::Status(CallStatus::Missed))
    ));
}

#[test]
fn test_list_call_records_attended_filter_still_supported() {
    let filter = build_filter(None, None, Some(false));
    let expr = filter.expect("attended should produce a filter");

    assert!(matches!(
        expr.as_ref(),
        Expr::Literal(CallLiteral::Attended(false))
    ));
}

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

fn schema_property<'a>(schema: &'a Value, property: &str) -> &'a Value {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .and_then(|properties| properties.get(property))
        .unwrap_or_else(|| panic!("schema should include `{property}` property"))
}

fn find_enum_values(schema: &Value) -> Option<Vec<String>> {
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        return Some(
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect(),
        );
    }

    for key in ["anyOf", "allOf"] {
        if let Some(values) = schema.get(key).and_then(Value::as_array) {
            if let Some(enum_values) = values.iter().find_map(find_enum_values) {
                return Some(enum_values);
            }
        }
    }

    None
}
