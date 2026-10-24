use super::*;

#[test]
fn canonical_whatsapp_share_address_supports_view_access() {
    let entity: ShareEntity = serde_json::from_value(serde_json::json!({
        "entityType": "whatsapp_group",
        "entityId": "00000000-0000-0000-0000-000000000123"
    }))
    .unwrap();
    assert_eq!(
        model_entity::EntityType::from(entity.entity_type),
        model_entity::EntityType::WhatsAppGroup
    );
    assert_eq!(
        supported_levels(entity.entity_type, None),
        vec![AccessLevel::View]
    );
}

#[test]
fn capabilities_match_existing_sharing() {
    assert_eq!(
        supported_levels(ShareEntityType::Document, Some("pdf")),
        vec![AccessLevel::View, AccessLevel::Comment]
    );
    assert_eq!(
        supported_levels(ShareEntityType::Document, Some("md")),
        vec![AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit]
    );
    assert_eq!(
        supported_levels(ShareEntityType::EmailThread, None),
        vec![AccessLevel::View]
    );
    assert_eq!(
        supported_levels(ShareEntityType::Document, Some("spreadsheet")),
        vec![AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit]
    );
    assert_eq!(
        supported_levels(ShareEntityType::Document, Some("csv")),
        vec![AccessLevel::View, AccessLevel::Comment]
    );
    assert_eq!(
        supported_levels(ShareEntityType::AgentSession, None),
        vec![AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit]
    );
}

#[test]
fn only_team_administrators_review_team_owned_entities() {
    let user = |name: &str| MacroUserIdStr::try_from(format!("macro|{name}@test.com")).unwrap();
    let facts = SharingFacts {
        owner: Owner::Team(Uuid::new_v4()),
        sponsor: None,
        team_members: vec![
            (user("member"), SharingTeamRole::Member),
            (user("admin"), SharingTeamRole::Admin),
            (user("owner"), SharingTeamRole::Owner),
        ],
        name: "Shared".into(),
        file_type: None,
    };
    assert_eq!(reviewers(&facts), vec![user("admin"), user("owner")]);
}
