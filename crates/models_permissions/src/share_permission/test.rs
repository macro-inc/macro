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
        channel_share_permissions: None,
    };

    let serialized = serde_json::to_value(&request).unwrap();
    assert!(serialized.get("linkShare").is_none());
    assert!(serialized.get("linkShareAccessLevel").is_none());

    let deserialized: UpdateSharePermissionRequestV2 = serde_json::from_value(serialized).unwrap();
    assert_eq!(deserialized.link_share, None);
    assert_eq!(deserialized.link_share_access_level, None);
}

#[test]
fn update_request_distinguishes_omitted_null_and_present_values() {
    let omitted: UpdateSharePermissionRequestV2 = serde_json::from_value(json!({})).unwrap();
    assert_eq!(omitted.link_share, None);
    assert_eq!(omitted.link_share_access_level, None);

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
