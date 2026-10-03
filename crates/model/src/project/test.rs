use super::{BasicProject, Project, ProjectPreviewData};
use model_owner::Owner;
use serde_json::json;

fn owner(principal: &str) -> Owner {
    Owner::from_principal_str(principal).unwrap()
}

#[test]
fn project_serde_keeps_user_id_wire_name() {
    let original = Project {
        id: "proj-1".to_string(),
        name: "Project".to_string(),
        user_id: owner("macro|owner@example.com"),
        parent_id: None,
        created_at: None,
        updated_at: None,
        deleted_at: None,
    };

    let serialized = serde_json::to_value(&original).unwrap();
    assert_eq!(serialized["userId"], "macro|owner@example.com");
    let deserialized: Project = serde_json::from_value(serialized).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn project_serde_accepts_bot_and_team_owners() {
    for principal in [
        "bot|00000000-0000-0000-0000-00000000a1a1",
        "01234567-89ab-cdef-0123-456789abcdef",
    ] {
        let original = Project {
            id: "proj-1".to_string(),
            name: "Project".to_string(),
            user_id: owner(principal),
            parent_id: None,
            created_at: None,
            updated_at: None,
            deleted_at: None,
        };
        let serialized = serde_json::to_value(&original).unwrap();
        assert_eq!(serialized["userId"], principal);
        let deserialized: Project = serde_json::from_value(serialized).unwrap();
        assert_eq!(original, deserialized);
    }
}

#[test]
fn basic_project_serde_keeps_user_id_wire_name() {
    let original = BasicProject {
        id: "proj-1".to_string(),
        user_id: owner("macro|owner@example.com"),
        parent_id: None,
        name: "Project".to_string(),
        deleted_at: None,
    };

    let serialized = serde_json::to_value(&original).unwrap();
    assert_eq!(serialized["userId"], "macro|owner@example.com");
    let deserialized: BasicProject = serde_json::from_value(serialized).unwrap();
    assert_eq!(original, deserialized);
}

#[test]
fn project_preview_data_serde_keeps_owner_wire_name() {
    let original = ProjectPreviewData {
        id: "proj-1".to_string(),
        name: "Project".to_string(),
        owner: owner("macro|owner@example.com"),
        path: vec!["Project".to_string()],
        updated_at: None,
    };

    let serialized = serde_json::to_value(&original).unwrap();
    assert_eq!(serialized["owner"], "macro|owner@example.com");
    assert_eq!(serialized["path"], json!(["Project"]));
    let deserialized: ProjectPreviewData = serde_json::from_value(serialized).unwrap();
    assert_eq!(original, deserialized);
}
