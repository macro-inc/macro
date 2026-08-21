use super::*;
use ai_toolset::schema::generate_validated_input_schema;
use macro_user_id::user_id::MacroUserIdStr;

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
fn ai_tool_create_is_delegated_to_the_requesting_user() {
    let user = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user");
    let attribution = ai_tool_attribution(user);
    assert_eq!(
        attribution.actor().as_ref(),
        bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(
        attribution.on_behalf_of().as_ref().map(|id| id.as_ref()),
        Some("macro|owner@example.com")
    );
}
