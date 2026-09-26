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
        let mut documents = MockInitiativeDescriptionDocuments::new();
        documents
            .expect_create()
            .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
        let created = service_with_documents(repo, documents)
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
async fn assignment_rejects_task_capability_for_another_principal() {
    let result = service(MockInitiativeRepo::new())
        .assign_tasks(
            edit_receipt(),
            vec![TaskAssignment::Authorized {
                receipt: task_receipt(OTHER, "task-1"),
            }],
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::Unauthorized)));
}

#[tokio::test]
async fn assignment_rejects_non_document_task_capability() {
    let result = service(MockInitiativeRepo::new())
        .assign_tasks(
            edit_receipt(),
            vec![TaskAssignment::Authorized {
                receipt: edit_receipt(),
            }],
        )
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn removal_rejects_task_capability_for_another_principal() {
    let result = service(MockInitiativeRepo::new())
        .unassign_task(edit_receipt(), task_receipt(OTHER, "task-1"))
        .await;
    assert!(matches!(result, Err(InitiativeError::Unauthorized)));
}

#[tokio::test]
async fn removal_requires_a_task_document_capability() {
    let result = service(MockInitiativeRepo::new())
        .unassign_task(edit_receipt(), edit_receipt())
        .await;
    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
    let clear = service(MockInitiativeRepo::new())
        .clear_task(edit_receipt())
        .await;
    assert!(matches!(clear, Err(InitiativeError::BadRequest(_))));
}

#[tokio::test]
async fn task_side_clear_needs_no_source_initiative_receipt() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_clear_task()
        .withf(|id| id == "task-1")
        .times(1)
        .return_once(|_| Box::pin(async { Ok(()) }));
    service(repo)
        .clear_task(task_receipt(OWNER, "task-1"))
        .await
        .expect("cleared");
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
