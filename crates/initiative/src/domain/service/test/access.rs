use super::*;

#[tokio::test]
async fn create_defaults_to_team_sharing_and_preserves_explicit_opt_out() {
    for (share_with_team, expected) in [
        (None, TeamShareCreation::Initiative),
        (Some(true), TeamShareCreation::Initiative),
        (Some(false), TeamShareCreation::Unshared),
    ] {
        let mut repo = MockInitiativeRepo::new();
        repo.expect_get_team_default_link_share()
            .return_once(|_| Box::pin(async { Ok(None) }));
        repo.expect_create()
            .withf(move |_, _, intent| *intent == expected)
            .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));
        let created = service(repo)
            .create(
                &user(OWNER),
                CreateInitiativeRequest {
                    name: "Launch".into(),
                    share_with_team,
                    ..Default::default()
                },
            )
            .await
            .expect("created");
        assert_eq!(created.user_access_level, AccessLevel::Owner);
    }
}

#[tokio::test]
async fn get_reports_verified_effective_access_instead_of_repository_placeholder() {
    for level in [
        AccessLevel::View,
        AccessLevel::Comment,
        AccessLevel::Edit,
        AccessLevel::Owner,
    ] {
        let mut repo = MockInitiativeRepo::new();
        repo.expect_get_detail()
            .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
        let response = service(repo)
            .get(receipt(OWNER, EntityType::Initiative, level))
            .await
            .expect("read");
        assert_eq!(response.user_access_level, level);
    }
}

#[tokio::test]
async fn update_reports_owner_access_instead_of_repository_placeholder() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_update()
        .return_once(|_| Box::pin(async { Ok(detail(Vec::new())) }));
    let response = service(repo)
        .update(
            owner_edit_receipt(),
            UpdateInitiativeRequest {
                name: Some("Renamed".into()),
                ..Default::default()
            },
        )
        .await
        .expect("updated");
    assert_eq!(response.user_access_level, AccessLevel::Owner);
}

#[tokio::test]
async fn editors_cannot_replace_or_clear_collaborators_but_can_rename() {
    for members in [vec![OTHER.to_string()], Vec::new()] {
        let result = service(MockInitiativeRepo::new())
            .update(
                edit_receipt(),
                UpdateInitiativeRequest {
                    member_ids: Some(members),
                    ..Default::default()
                },
            )
            .await;
        assert!(matches!(result, Err(InitiativeError::Unauthorized)));
    }

    let mut repo = MockInitiativeRepo::new();
    repo.expect_update()
        .withf(|args| {
            args.name.as_deref() == Some("Renamed")
                && args.member_ids_added.is_empty()
                && args.member_ids_removed.is_empty()
        })
        .times(1)
        .return_once(|_| Box::pin(async { Ok(detail(Vec::new())) }));
    service(repo)
        .update(
            edit_receipt(),
            UpdateInitiativeRequest {
                name: Some("Renamed".into()),
                ..Default::default()
            },
        )
        .await
        .expect("editors may rename the project");
}

#[tokio::test]
async fn all_lifecycle_operations_validate_initiative_entity_type() {
    let svc = service(MockInitiativeRepo::new());
    assert!(matches!(
        svc.get(receipt(OWNER, EntityType::Document, AccessLevel::View))
            .await,
        Err(InitiativeError::BadRequest(_))
    ));
    assert!(matches!(
        svc.update(
            receipt(OWNER, EntityType::Document, AccessLevel::Owner),
            UpdateInitiativeRequest::default()
        )
        .await,
        Err(InitiativeError::BadRequest(_))
    ));
    assert!(matches!(
        svc.delete(receipt(OWNER, EntityType::Document, AccessLevel::Owner))
            .await,
        Err(InitiativeError::BadRequest(_))
    ));
}

#[tokio::test]
async fn assignee_sharing_deduplicates_and_keeps_owner_assignable() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_grant_assignees()
        .withf(|id, users| *id == initiative_id() && users == &vec![user(OWNER), user(MEMBER)])
        .times(1)
        .return_once(|_, _| Box::pin(async { Ok(()) }));
    service(repo)
        .grant_assignees(
            edit_receipt(),
            vec![user(OWNER), user(MEMBER), user(MEMBER)],
        )
        .await
        .expect("granted");
}
