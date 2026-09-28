use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn upload_schema_is_valid_and_project_is_optional() {
    let schema = generate_validated_input_schema::<UploadFile>().unwrap();
    assert_eq!(schema.name, "UploadFile");
    let tool: UploadFile = serde_json::from_value(serde_json::json!({
        "fileName": "file.bin", "contentBase64": "AP+A"
    }))
    .unwrap();
    assert!(tool.project_id.is_none());
    assert_eq!(decode_content(&tool.content_base64).unwrap(), [0, 255, 128]);
}

#[test]
fn rejects_invalid_or_oversized_base64() {
    for content in ["data:application/pdf;base64,YQ==", "Y Q==", "YQ", "!!!!"] {
        assert!(decode_content(content).is_err());
    }
    assert!(decode_content(&"A".repeat(MAX_INLINE_UPLOAD_BYTES.div_ceil(3) * 4 + 1)).is_err());
    assert_eq!(
        decode_content(&STANDARD.encode(vec![255; MAX_INLINE_UPLOAD_BYTES]))
            .unwrap()
            .len(),
        MAX_INLINE_UPLOAD_BYTES
    );
    assert!(decode_content("").unwrap().is_empty());
}
