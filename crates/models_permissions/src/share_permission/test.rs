use model_file_type::FileType;
use serde_json::json;

use super::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2, access_level::AccessLevel,
};

#[test]
fn document_constructor_uses_expected_link_share_defaults() {
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Md)),
        SharePermissionV2 {
            id: String::new(),
            link_share: Some(LinkShare::Public),
            link_share_access_level: Some(AccessLevel::Edit),
            owner: String::new(),
            channel_share_permissions: None,
        }
    );
    assert_eq!(
        SharePermissionV2::new_document_share_permission(Some(FileType::Pdf)),
        SharePermissionV2 {
            id: String::new(),
            link_share: None,
            link_share_access_level: None,
            owner: String::new(),
            channel_share_permissions: None,
        }
    );
}

#[test]
fn chat_constructor_enables_public_view_access() {
    assert_eq!(
        SharePermissionV2::new_chat_share_permission(),
        SharePermissionV2 {
            id: String::new(),
            link_share: Some(LinkShare::Public),
            link_share_access_level: Some(AccessLevel::View),
            owner: String::new(),
            channel_share_permissions: None,
        }
    );
}

#[test]
fn project_constructor_disables_link_sharing() {
    assert_eq!(
        SharePermissionV2::new_project_share_permission(),
        SharePermissionV2 {
            id: String::new(),
            link_share: None,
            link_share_access_level: None,
            owner: String::new(),
            channel_share_permissions: None,
        }
    );
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
