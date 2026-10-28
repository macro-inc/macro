//! Form surfaces: snapshot ensures and form-scoped tokens.

use super::*;

#[tokio::test]
async fn a_form_surface_is_created_ready_from_its_snapshot() {
    let repo = Arc::new(MemRepo::default());
    let form_id = uuid::Uuid::parse_str("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90").unwrap();
    let mut init = MockSurfaceInitializer::new();
    init.expect_session_exists()
        .withf(|session| session == "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90")
        .times(1)
        .returning(|_| Box::pin(async { Ok(false) }));
    init.expect_initialize_from_snapshot()
        .withf(|session, snapshot| {
            session == "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90"
                && snapshot == [0x6c, 0x6f, 0x72, 0x6f]
        })
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    init.expect_initialize().never();
    let svc = service_with(repo.clone(), init);

    let surface = svc
        .ensure_owned_surface_from_snapshot(
            EntityType::Form.with_entity_string("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90".to_string()),
            form_id,
            vec![0x6c, 0x6f, 0x72, 0x6f],
        )
        .await
        .unwrap();

    assert_eq!(surface.id, form_id);
    assert_eq!(
        surface.parent,
        EntityType::Form.with_entity_string("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90".to_string())
    );
    assert_eq!(surface.state, SurfaceState::Ready);
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Ready);
}

#[test]
fn forms_own_their_surfaces() {
    assert_eq!(
        surface_ownership(EntityType::Form),
        Some(SurfaceOwnership::ParentDomain)
    );
}

#[tokio::test]
async fn a_ready_snapshot_surface_keeps_its_content() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    // A ready surface never reaches the initializer: the seed is ignored.
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    let surface = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![9, 9, 9])
        .await
        .unwrap();

    assert_eq!(surface.state, SurfaceState::Ready);
    assert_eq!(repo.document_lookups.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_snapshot_ensure_is_idempotent() {
    let repo = Arc::new(MemRepo::default());
    let id = surface_id();
    let mut init = no_sessions();
    init.expect_initialize_from_snapshot()
        .withf(|_, snapshot| snapshot == [1, 2, 3])
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    let first = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![1, 2, 3])
        .await
        .unwrap();
    let second = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![4, 5, 6])
        .await
        .unwrap();

    assert_eq!(first.state, SurfaceState::Ready);
    assert_eq!(second.state, SurfaceState::Ready);
    assert_eq!(second.parent, form_parent(id));
}

#[tokio::test]
async fn a_snapshot_ensure_refuses_a_surface_bound_to_another_parent() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(surface_id()), id, vec![1])
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::AccessDenied));
    assert_eq!(repo.stored().unwrap().parent, form_parent(id));
}

#[tokio::test]
async fn a_snapshot_ensure_refuses_an_empty_snapshot() {
    let repo = Arc::new(MemRepo::default());
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());
    let id = surface_id();

    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, Vec::new())
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::BadRequest(_)));
    assert!(repo.stored().is_none());
}

#[tokio::test]
async fn a_snapshot_ensure_follows_the_shared_id_rules() {
    let repo = Arc::new(MemRepo::default());
    repo.document_ids.store(true, Ordering::SeqCst);
    let svc = service_with(repo.clone(), no_sessions());
    let id = surface_id();

    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![1])
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::IdReserved));
    assert!(repo.stored().is_none());

    let not_random = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, b"form");
    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(not_random), not_random, vec![1])
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::BadRequest(_)));
}

#[tokio::test]
async fn a_retired_snapshot_surface_is_gone() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    repo.soft_deleted.store(true, Ordering::SeqCst);
    let mut init = MockSurfaceInitializer::new();
    init.expect_session_exists()
        .returning(|_| Box::pin(async { Ok(true) }));
    let svc = service_with(repo, init);

    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![1])
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::Gone));
}

#[tokio::test]
async fn a_failed_snapshot_init_stays_pending_until_a_retry_succeeds() {
    let repo = Arc::new(MemRepo::default());
    let id = surface_id();
    let mut init = MockSurfaceInitializer::new();
    // Only the fresh ensure checks for a session; the retry trusts its row.
    init.expect_session_exists()
        .times(1)
        .returning(|_| Box::pin(async { Ok(false) }));
    let calls = Arc::new(AtomicUsize::new(0));
    let calls_in_mock = calls.clone();
    init.expect_initialize_from_snapshot()
        .withf(|_, snapshot| snapshot == [7, 7])
        .times(2)
        .returning(move |_, _| {
            let call = calls_in_mock.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                if call == 0 {
                    Err(CollabSurfaceError::Internal(
                        rootcause::Report::new(MemErr).into_dynamic(),
                    ))
                } else {
                    Ok(())
                }
            })
        });
    let svc = service_with(repo.clone(), init);

    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![7, 7])
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::Internal(_)));
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Pending);
    assert!(
        svc.owned_surface_markdown(id).await.unwrap().is_none(),
        "a pending surface is not readable"
    );

    let surface = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![7, 7])
        .await
        .unwrap();
    assert_eq!(surface.state, SurfaceState::Ready);
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Ready);
}

#[tokio::test]
async fn a_snapshot_init_whose_mark_ready_failed_heals_on_retry() {
    let repo = Arc::new(MemRepo::default());
    repo.mark_ready_failures.store(1, Ordering::SeqCst);
    let id = surface_id();
    let mut init = no_sessions();
    // The retry finds the session the first ensure created, which the
    // initializer reports as success.
    init.expect_initialize_from_snapshot()
        .times(2)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    svc.ensure_owned_surface_from_snapshot(form_parent(id), id, vec![1])
        .await
        .unwrap_err();
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Pending);

    let surface = svc
        .ensure_owned_surface_from_snapshot(form_parent(id), id, vec![1])
        .await
        .unwrap();
    assert_eq!(surface.state, SurfaceState::Ready);
}

#[tokio::test]
async fn concurrent_snapshot_ensures_of_a_new_form_both_end_ready() {
    let repo = Arc::new(MemRepo::default());
    let mut init = MockSurfaceInitializer::new();
    // Both ensures pass the pre-insert checks before either inserts.
    let both_checked = Arc::new(tokio::sync::Barrier::new(2));
    init.expect_session_exists().times(2).returning(move |_| {
        let both_checked = both_checked.clone();
        Box::pin(async move {
            both_checked.wait().await;
            Ok(false)
        })
    });
    init.expect_initialize_from_snapshot()
        .times(1..=2)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);
    let id = surface_id();

    let (first, second) = tokio::join!(
        svc.ensure_owned_surface_from_snapshot(form_parent(id), id, vec![1]),
        svc.ensure_owned_surface_from_snapshot(form_parent(id), id, vec![2]),
    );

    assert_eq!(first.unwrap().state, SurfaceState::Ready);
    assert_eq!(second.unwrap().state, SurfaceState::Ready);
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Ready);
}

#[tokio::test]
async fn the_public_api_never_ensures_or_deletes_a_form_surface() {
    let id = surface_id();

    let empty = Arc::new(MemRepo::default());
    let svc = service_with(empty.clone(), MockSurfaceInitializer::new());
    let err = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            form_receipt(id, AccessLevel::Owner),
            id,
            String::new(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
    assert!(empty.stored().is_none());

    let repo = MemRepo::holding(ready_form_surface(id));
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());
    let err = svc
        .delete_surface(
            &user("macro|a@b.c"),
            form_receipt(id, AccessLevel::Owner),
            id,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
    assert!(!repo.soft_deleted.load(Ordering::SeqCst));
}

#[tokio::test]
async fn a_form_surface_token_requires_edit_on_the_form() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    let svc = service_with(repo, MockSurfaceInitializer::new());

    // Respondents hold View; the draft is not theirs to read.
    for denied in [AccessLevel::View, AccessLevel::Comment] {
        let err = svc
            .mint_token(&user("macro|a@b.c"), form_receipt(id, denied), id)
            .await
            .unwrap_err();
        assert!(
            matches!(err, CollabSurfaceError::AccessDenied),
            "{denied:?}"
        );
    }

    for allowed in [AccessLevel::Edit, AccessLevel::Owner] {
        let token = svc
            .mint_token(&user("macro|a@b.c"), form_receipt(id, allowed), id)
            .await
            .unwrap();
        let claims: model::document::DocumentPermissionsToken =
            macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
        assert_eq!(claims.document_id, id.to_string());
        assert_eq!(claims.access_level, allowed);
    }
}

#[tokio::test]
async fn an_anonymous_visitor_never_gets_a_form_surface_token() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    let svc = service_with(repo, MockSurfaceInitializer::new());
    // A public form resolves View for an anonymous visitor.
    let anonymous = EntityAccessReceipt::try_new(
        entity_access::domain::models::EntityAccessAuth::Unauthenticated,
        entity_access::domain::models::Entity {
            entity_id: id.to_string(),
            entity_type: EntityType::Form,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();

    let err = svc
        .mint_token(&user("macro|a@b.c"), anonymous, id)
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::AccessDenied));
}

#[tokio::test]
async fn other_parents_keep_view_tokens() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_initiative_surface(id));
    let svc = service_with(repo, MockSurfaceInitializer::new());
    let receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Initiative,
        &id.to_string(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    );

    let token = svc
        .mint_token(&user("macro|a@b.c"), receipt, id)
        .await
        .unwrap();
    let claims: model::document::DocumentPermissionsToken =
        macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
    assert_eq!(claims.access_level, AccessLevel::View);
}
