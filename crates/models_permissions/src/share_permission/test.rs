use model_file_type::FileType;
use serde_json::json;

use super::{
    LinkShare, SharePermissionV2, TeamLinkShareDefault, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
};

fn share(
    link_share: Option<LinkShare>,
    link_share_access_level: Option<AccessLevel>,
) -> SharePermissionV2 {
    SharePermissionV2 {
        id: String::new(),
        link_share,
        link_share_access_level,
        team_share_access_level: None,
        owner: String::new(),
        channel_share_permissions: None,
    }
}

const TEAM_PUBLIC: Option<TeamLinkShareDefault> =
    Some(TeamLinkShareDefault(Some(LinkShare::Public)));
const TEAM_TEAM: Option<TeamLinkShareDefault> = Some(TeamLinkShareDefault(Some(LinkShare::Team)));
const TEAM_OFF: Option<TeamLinkShareDefault> = Some(TeamLinkShareDefault(None));

#[test]
fn document_constructor_without_team_uses_entity_defaults() {
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Md), None),
        share(Some(LinkShare::Public), Some(AccessLevel::Edit))
    );
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Pdf), None),
        share(None, None)
    );
}

#[test]
fn document_constructor_follows_team_scope_and_keeps_entity_level() {
    // Md keeps its Edit level; only the scope follows the team preference.
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Md), TEAM_TEAM),
        share(Some(LinkShare::Team), Some(AccessLevel::Edit))
    );
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Md), TEAM_PUBLIC),
        share(Some(LinkShare::Public), Some(AccessLevel::Edit))
    );
    // Non-md docs have no entity level, so a team scope falls back to View.
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Pdf), TEAM_TEAM),
        share(Some(LinkShare::Team), Some(AccessLevel::View))
    );
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Pdf), TEAM_PUBLIC),
        share(Some(LinkShare::Public), Some(AccessLevel::View))
    );
}

#[test]
fn document_constructor_respects_team_link_share_off() {
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Md), TEAM_OFF),
        share(None, None)
    );
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Pdf), TEAM_OFF),
        share(None, None)
    );
}

#[test]
fn chat_constructor_without_team_enables_public_view_access() {
    assert_eq!(
        SharePermissionV2::new_chat_share_permission(None),
        share(Some(LinkShare::Public), Some(AccessLevel::View))
    );
}

#[test]
fn chat_constructor_follows_team_default() {
    assert_eq!(
        SharePermissionV2::new_chat_share_permission(TEAM_PUBLIC),
        share(Some(LinkShare::Public), Some(AccessLevel::View))
    );
    assert_eq!(
        SharePermissionV2::new_chat_share_permission(TEAM_TEAM),
        share(Some(LinkShare::Team), Some(AccessLevel::View))
    );
    assert_eq!(
        SharePermissionV2::new_chat_share_permission(TEAM_OFF),
        share(None, None)
    );
}

#[test]
fn project_constructor_without_team_disables_link_sharing() {
    assert_eq!(
        SharePermissionV2::new_project_share_permission(None),
        share(None, None)
    );
}

#[test]
fn project_constructor_follows_team_default() {
    assert_eq!(
        SharePermissionV2::new_project_share_permission(TEAM_PUBLIC),
        share(Some(LinkShare::Public), Some(AccessLevel::View))
    );
    assert_eq!(
        SharePermissionV2::new_project_share_permission(TEAM_TEAM),
        share(Some(LinkShare::Team), Some(AccessLevel::View))
    );
    assert_eq!(
        SharePermissionV2::new_project_share_permission(TEAM_OFF),
        share(None, None)
    );
}

#[test]
fn resolved_permissions_never_have_a_level_without_a_scope() {
    // Mirrors the DB check constraint: linkShareAccessLevel must be NULL when linkShare is NULL.
    for team_default in [None, TEAM_PUBLIC, TEAM_TEAM, TEAM_OFF] {
        for permission in [
            SharePermissionV2::new_document_share_permission(Some(FileType::Md), team_default),
            SharePermissionV2::new_document_share_permission(Some(FileType::Pdf), team_default),
            SharePermissionV2::new_document_share_permission(None, team_default),
            SharePermissionV2::new_chat_share_permission(team_default),
            SharePermissionV2::new_project_share_permission(team_default),
        ] {
            assert_eq!(permission.team_share_access_level, None);
            if permission.link_share.is_none() {
                assert_eq!(permission.link_share_access_level, None);
            } else {
                assert!(permission.link_share_access_level.is_some());
            }
        }
    }
}

#[test]
fn update_request_round_trip_preserves_omitted_fields() {
    let request = UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: None,
    };

    let serialized = serde_json::to_value(&request).unwrap();
    assert!(serialized.get("linkShare").is_none());
    assert!(serialized.get("linkShareAccessLevel").is_none());
    assert!(serialized.get("teamShareAccessLevel").is_none());

    let deserialized: UpdateSharePermissionRequestV2 = serde_json::from_value(serialized).unwrap();
    assert_eq!(deserialized.link_share, None);
    assert_eq!(deserialized.link_share_access_level, None);
    assert_eq!(deserialized.team_share_access_level, None);
}

#[test]
fn team_share_update_round_trip_preserves_null_and_levels() {
    for (value, level) in [
        (json!(null), None),
        (json!("view"), Some(AccessLevel::View)),
        (json!("comment"), Some(AccessLevel::Comment)),
        (json!("edit"), Some(AccessLevel::Edit)),
    ] {
        let request: UpdateSharePermissionRequestV2 = serde_json::from_value(json!({
            "teamShareAccessLevel": value,
        }))
        .unwrap();
        assert_eq!(request.team_share_access_level, Some(level));
        assert_eq!(
            serde_json::to_value(&request).unwrap()["teamShareAccessLevel"],
            value
        );
        assert_eq!(request.link_share, None);
        assert_eq!(request.link_share_access_level, None);
    }
}

#[test]
fn team_share_read_serializes_null_and_levels_without_internal_state() {
    for level in [
        None,
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
    ] {
        let mut permission = share(None, None);
        permission.team_share_access_level = level;
        let serialized = serde_json::to_value(&permission).unwrap();
        assert_eq!(serialized.get("teamShareAccessLevel"), Some(&json!(level)));
        assert!(serialized.get("teamShareTeamId").is_none());
        assert!(serialized.get("teamShareRevision").is_none());
        assert_eq!(
            serde_json::from_value::<SharePermissionV2>(serialized).unwrap(),
            permission
        );
    }
}

#[test]
fn permission_schemas_expose_only_the_public_team_level() {
    use utoipa::PartialSchema;

    for schema in [
        SharePermissionV2::schema(),
        UpdateSharePermissionRequestV2::schema(),
    ] {
        let schema = serde_json::to_value(schema).unwrap();
        let properties = schema["properties"].as_object().unwrap();
        assert!(properties.contains_key("teamShareAccessLevel"));
        assert!(!properties.contains_key("teamShareTeamId"));
        assert!(!properties.contains_key("teamShareRevision"));
    }
}

#[test]
fn update_request_distinguishes_omitted_null_and_present_values() {
    let omitted: UpdateSharePermissionRequestV2 = serde_json::from_value(json!({})).unwrap();
    assert_eq!(omitted.link_share, None);
    assert_eq!(omitted.link_share_access_level, None);
    assert_eq!(omitted.team_share_access_level, None);

    let cleared: UpdateSharePermissionRequestV2 = serde_json::from_value(json!({
        "linkShare": null,
        "linkShareAccessLevel": null
    }))
    .unwrap();
    assert_eq!(cleared.link_share, Some(None));
    assert_eq!(cleared.link_share_access_level, Some(None));

    let updated: UpdateSharePermissionRequestV2 = serde_json::from_value(json!({
        "linkShare": "TEAM",
        "linkShareAccessLevel": "comment"
    }))
    .unwrap();
    assert_eq!(updated.link_share, Some(Some(LinkShare::Team)));
    assert_eq!(
        updated.link_share_access_level,
        Some(Some(AccessLevel::Comment))
    );
}
