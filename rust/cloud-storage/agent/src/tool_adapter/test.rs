use super::*;

#[test]
fn empty_object_schema_gains_properties() {
    let mut schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "title": "ListLabels",
        "description": "List the user's Gmail labels."
    });
    normalize_request_schema(&mut schema);
    assert_eq!(schema["properties"], serde_json::json!({}));
}

#[test]
fn object_schema_with_properties_is_unchanged() {
    let original = serde_json::json!({
        "type": "object",
        "properties": { "input": { "type": "string" } },
        "required": ["input"]
    });
    let mut schema = original.clone();
    normalize_request_schema(&mut schema);
    assert_eq!(schema, original);
}

#[test]
fn nested_empty_objects_gain_properties() {
    let mut schema = serde_json::json!({
        "type": "object",
        "properties": {
            "config": { "type": "object" },
            "variants": { "anyOf": [{ "type": "object" }, { "type": "null" }] },
            "list": { "type": "array", "items": { "type": "object" } }
        },
        "$defs": {
            "Empty": { "type": "object" }
        }
    });
    normalize_request_schema(&mut schema);
    assert_eq!(
        schema["properties"]["config"]["properties"],
        serde_json::json!({})
    );
    assert_eq!(
        schema["properties"]["variants"]["anyOf"][0]["properties"],
        serde_json::json!({})
    );
    assert_eq!(
        schema["properties"]["list"]["items"]["properties"],
        serde_json::json!({})
    );
    assert_eq!(
        schema["$defs"]["Empty"]["properties"],
        serde_json::json!({})
    );
}

#[test]
fn non_object_schemas_are_unchanged() {
    let original = serde_json::json!({ "type": "string", "description": "plain" });
    let mut schema = original.clone();
    normalize_request_schema(&mut schema);
    assert_eq!(schema, original);
}
