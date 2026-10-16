use super::*;

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
