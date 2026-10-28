use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn read_design_has_a_valid_model_schema() {
    let read = generate_validated_input_schema::<ReadDesign>().unwrap();
    assert_eq!(read.name, "ReadDesign");
    let schema = serde_json::to_string(&read.schema).unwrap();
    assert!(schema.contains("\"documentId\""), "{schema}");
    assert!(schema.contains("\"pages\""), "{schema}");
}

/// Strict-mode providers send `null` for each optional field.
#[test]
fn strict_mode_calls_deserialize() {
    let call: ReadDesign = serde_json::from_value(serde_json::json!({
        "documentId": "019fd3b9-3c6c-7c05-89c2-a27f01218141",
        "pages": null
    }))
    .unwrap();
    assert!(call.pages.is_none());
    let call: ReadDesign = serde_json::from_value(serde_json::json!({
        "documentId": "019fd3b9-3c6c-7c05-89c2-a27f01218141",
        "pages": [2, 3]
    }))
    .unwrap();
    assert_eq!(call.pages, Some(vec![2, 3]));
}
