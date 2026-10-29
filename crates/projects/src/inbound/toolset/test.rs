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

#[test]
fn test_entity_lifecycle_schema_validation() {
    for (name, result) in [
        (
            "MoveToTrash",
            generate_validated_input_schema::<MoveToTrash>(),
        ),
        (
            "DuplicateItem",
            generate_validated_input_schema::<DuplicateItem>(),
        ),
        (
            "RenameItem",
            generate_validated_input_schema::<RenameItem>(),
        ),
        (
            "UpdateSharing",
            generate_validated_input_schema::<UpdateSharing>(),
        ),
    ] {
        let validated = result.unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(validated.name, name);
    }
}

#[test]
fn test_move_to_trash_rejects_untrashable_kinds() {
    let tool = serde_json::from_value::<MoveToTrash>(serde_json::json!({
        "entityType": "channel",
        "entityId": "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc",
    }));
    assert!(tool.is_err(), "channels are not trashed with MoveToTrash");
}

fn sharing(input: serde_json::Value) -> UpdateSharing {
    serde_json::from_value(input).expect("valid input")
}

#[test]
fn test_update_sharing_maps_off_to_disabling_each_share() {
    use models_permissions::share_permission::channel_share_permission::UpdateOperation;

    let tool = sharing(serde_json::json!({
        "entityType": "document",
        "entityId": "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc",
        "linkScope": "off",
        "teamAccess": "off",
        "channels": [{
            "channelId": "0f6d9a0e-1b62-4f53-9f4c-0b9e2f6f0c11",
            "access": "off",
        }],
    }));
    let policy = tool.policy();

    assert_eq!(policy.link_share, Some(None));
    assert_eq!(policy.team_share_access_level, Some(None));
    assert_eq!(
        policy.link_share_access_level, None,
        "omitted stays unchanged"
    );
    let channels = policy.channel_share_permissions.expect("channel change");
    assert_eq!(channels[0].operation, UpdateOperation::Remove);
    assert_eq!(channels[0].access_level, None);
}

#[test]
fn test_update_sharing_maps_grants_to_levels() {
    use models_permissions::share_permission::{
        LinkShare, access_level::AccessLevel, channel_share_permission::UpdateOperation,
    };

    let tool = sharing(serde_json::json!({
        "entityType": "project",
        "entityId": "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc",
        "linkScope": "team",
        "linkAccess": "comment",
        "teamAccess": "edit",
        "channels": [{
            "channelId": "0f6d9a0e-1b62-4f53-9f4c-0b9e2f6f0c11",
            "access": "view",
        }],
    }));
    let policy = tool.policy();

    assert_eq!(policy.link_share, Some(Some(LinkShare::Team)));
    assert_eq!(
        policy.link_share_access_level,
        Some(Some(AccessLevel::Comment))
    );
    assert_eq!(
        policy.team_share_access_level,
        Some(Some(AccessLevel::Edit))
    );
    let channels = policy.channel_share_permissions.expect("channel change");
    assert_eq!(channels[0].operation, UpdateOperation::Replace);
    assert_eq!(channels[0].access_level, Some(AccessLevel::View));
}

#[test]
fn test_update_sharing_detects_an_empty_change() {
    let empty = sharing(serde_json::json!({
        "entityType": "project",
        "entityId": "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc",
        "channels": [],
    }));
    assert!(empty.is_empty());

    let change = sharing(serde_json::json!({
        "entityType": "project",
        "entityId": "d50676e2-0a12-4c62-bc07-4b1cb6d8e9bc",
        "teamAccess": "view",
    }));
    assert!(!change.is_empty());
}
