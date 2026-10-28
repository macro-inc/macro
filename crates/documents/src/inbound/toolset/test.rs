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
fn test_comment_on_text_schema_validation() {
    let result = generate_validated_input_schema::<CommentOnText>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "CommentOnText",
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
fn test_comment_on_text_schema_fields() {
    let schema = schemars::schema_for!(CommentOnText).to_value();
    assert_eq!(
        schema["required"],
        serde_json::json!(["documentId", "content", "quote"])
    );
    let properties = schema["properties"].as_object().unwrap();
    assert_eq!(properties.len(), 4);
    for name in ["documentId", "content", "quote", "occurrence"] {
        assert!(properties.contains_key(name), "missing {name}");
    }
    assert_eq!(properties["occurrence"]["minimum"], 1);

    let response = schemars::schema_for!(comment_on_text::CommentOnTextResponse).to_value();
    assert_eq!(
        response["required"],
        serde_json::json!(["documentId", "threadId", "commentId", "markedText"])
    );
}

#[test]
fn test_create_skill_schema_validation() {
    let validated = generate_validated_input_schema::<CreateSkill>()
        .unwrap_or_else(|error| panic!("CreateSkill: {error:?}"));
    assert_eq!(validated.name, "CreateSkill");
}
