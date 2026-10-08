use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_read_metadata_schema_validation() {
    let result = generate_validated_input_schema::<ReadMetadata>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ReadMetadata",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("Retrieve"),
        "Description should contain expected text"
    );
}

#[test]
fn test_read_content_schema_validation() {
    let result = generate_validated_input_schema::<ReadContent>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ReadContent",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("Retrieve"),
        "Description should contain expected text"
    );
}

#[test]
fn test_create_document_schema_validation() {
    let result = generate_validated_input_schema::<CreateDocument>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "CreateDocument",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("Create"),
        "Description should contain expected text"
    );
}

#[test]
fn test_rename_document_schema_validation() {
    let result = generate_validated_input_schema::<RenameDocument>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "RenameDocument",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("Rename"),
        "Description should contain expected text"
    );
}

#[test]
fn test_resolve_document_comment_schema_validation() {
    let result = generate_validated_input_schema::<ResolveDocumentComment>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ResolveDocumentComment",
        "Tool name should match the schemars title"
    );
    assert!(
        validated
            .description
            .contains("Only use this when explicitly asked"),
        "Description should limit when the tool resolves"
    );
}

#[test]
fn test_comment_on_document_schema_validation() {
    let result = generate_validated_input_schema::<CommentOnDocument>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "CommentOnDocument",
        "Tool name should match the schemars title"
    );
    assert!(
        validated
            .description
            .contains("Only use this when explicitly asked"),
        "Description should limit when the tool posts"
    );
}

#[test]
fn test_comment_on_document_schema_fields() {
    let schema = schemars::schema_for!(CommentOnDocument).to_value();
    assert_eq!(
        schema["required"],
        serde_json::json!(["documentId", "content"])
    );
    let properties = schema["properties"].as_object().unwrap();
    assert_eq!(properties.len(), 5);
    for name in ["documentId", "content", "threadId", "quote", "occurrence"] {
        assert!(properties.contains_key(name), "missing {name}");
    }
    assert_eq!(properties["occurrence"]["minimum"], 1);

    let response = schemars::schema_for!(comment_on_document::CommentOnDocumentResponse).to_value();
    assert_eq!(
        response["required"],
        serde_json::json!(["documentId", "threadId", "commentId"])
    );
    assert!(response["properties"].get("markedText").is_some());
}
