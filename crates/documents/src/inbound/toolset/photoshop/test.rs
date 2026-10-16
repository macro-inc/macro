use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn read_photoshop_document_has_a_valid_model_schema() {
    let read = generate_validated_input_schema::<ReadPhotoshopDocument>().unwrap();
    assert_eq!(read.name, "ReadPhotoshopDocument");
    let schema = serde_json::to_string(&read.schema).unwrap();
    assert!(schema.contains("\"documentId\""), "{schema}");
}

#[test]
fn calls_deserialize() {
    let call: ReadPhotoshopDocument = serde_json::from_value(serde_json::json!({
        "documentId": "019fd3b9-3c6c-7c05-89c2-a27f01218141"
    }))
    .unwrap();
    assert_eq!(call.document_id, "019fd3b9-3c6c-7c05-89c2-a27f01218141");
}
