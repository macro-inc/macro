use super::*;

#[test]
fn canonical_external_chat_share_address_supports_view_access() {
    let entity: ShareEntity = serde_json::from_value(serde_json::json!({
        "entityType": "external_chat",
        "entityId": "00000000-0000-0000-0000-000000000123"
    }))
    .unwrap();
    assert_eq!(
        model_entity::EntityType::from(entity.entity_type),
        model_entity::EntityType::ExternalChat
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
        agent_harness: None,
    };
    assert_eq!(reviewers(&facts), vec![user("admin"), user("owner")]);
}

#[test]
fn agent_harness_reviewers_are_human_owner_and_team_administrators_only() {
    use models_permissions::sharing::AgentHarnessFacts;
    let user =
        |name: &str| MacroUserIdStr::try_from(format!("macro|{name}@requests.test")).unwrap();
    let mut facts = SharingFacts {
        owner: Owner::User(user("inviter")),
        sponsor: None,
        team_members: vec![
            (user("member"), SharingTeamRole::Member),
            (user("admin"), SharingTeamRole::Admin),
            (user("teamowner"), SharingTeamRole::Owner),
            (user("agent"), SharingTeamRole::Admin),
        ],
        name: "Agent computer".into(),
        file_type: None,
        agent_harness: Some(AgentHarnessFacts {
            team_id: Uuid::from_u128(0x100),
            agent_user_id: Some(user("agent")),
        }),
    };
    assert_eq!(
        reviewers(&facts),
        vec![user("inviter"), user("admin"), user("teamowner")]
    );
    assert_eq!(
        supported_levels_for(ShareEntityType::Harness, &facts),
        vec![AccessLevel::View]
    );
    facts.agent_harness.as_mut().unwrap().agent_user_id = None;
    assert_eq!(
        supported_levels_for(ShareEntityType::Harness, &facts),
        vec![AccessLevel::View]
    );
    facts.agent_harness = None;
    assert_eq!(reviewers(&facts), vec![user("inviter")]);
    assert_eq!(
        supported_levels_for(ShareEntityType::Harness, &facts),
        vec![AccessLevel::View, AccessLevel::Edit]
    );
}
