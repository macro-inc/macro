use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_create_project_schema_validation() {
    let result = generate_validated_input_schema::<CreateProject>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "CreateProject",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("Create"),
        "Description should contain expected text"
    );
}

#[test]
fn test_read_project_schema_validation() {
    let result = generate_validated_input_schema::<ReadProject>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ReadProject",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("List"),
        "Description should contain expected text"
    );
}

#[test]
fn test_move_to_project_schema_validation() {
    let result = generate_validated_input_schema::<MoveToProject>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "MoveToProject",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("Move"),
        "Description should contain expected text"
    );
}

#[test]
fn test_move_to_project_deserializes_entity_types() {
    for (raw, expected) in [
        ("document", MoveableEntityType::Document),
        ("chat", MoveableEntityType::Chat),
        ("email", MoveableEntityType::Email),
        ("project", MoveableEntityType::Project),
    ] {
        let tool: MoveToProject = serde_json::from_value(serde_json::json!({
            "entityType": raw,
            "entityId": "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc",
        }))
        .expect("valid input");
        assert_eq!(tool.entity_type, expected);
        assert!(tool.project_id.is_none());
    }
}
