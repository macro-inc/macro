//! The sync-service namespace surfaces share with documents, and existing sessions.

use super::*;

#[tokio::test]
async fn ensure_refuses_an_id_that_names_a_document() {
    let repo = Arc::new(MemRepo::default());
    repo.document_ids.store(true, Ordering::SeqCst);
    // The initializer would report the document's session as "already
    // initialized" and let the surface adopt it; it must never be reached.
    let svc = service_with(repo.clone(), no_sessions());
    let receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Document,
        "doc-2",
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    );

    let id = surface_id();
    for _ in 0..2 {
        let err = svc
            .ensure_surface(&user("macro|a@b.c"), receipt.clone(), id, String::new())
            .await
            .unwrap_err();
        assert!(matches!(err, CollabSurfaceError::IdReserved));
    }
    // Nothing is left behind binding the id to the caller's parent.
    assert!(repo.surface.lock().unwrap().is_none());
}

#[tokio::test]
async fn a_pending_surface_with_a_document_id_is_never_initialized() {
    let repo = Arc::new(MemRepo::default());
    repo.document_ids.store(true, Ordering::SeqCst);
    let id = surface_id();
    let now = chrono::Utc::now();
    // A pending row for a document id, as written before ids were reserved.
    *repo.surface.lock().unwrap() = Some(CollabSurface {
        id,
        parent: EntityType::Document.with_entity_string("doc-1".to_string()),
        state: SurfaceState::Pending,
        created_at: now,
        updated_at: now,
    });
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());
    let receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Document,
        "doc-1",
        edit_permission(),
    );

    let err = svc
        .ensure_surface(&user("macro|a@b.c"), receipt, id, String::new())
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::IdReserved));
    assert_eq!(
        repo.surface.lock().unwrap().as_ref().unwrap().state,
        SurfaceState::Pending
    );
}

#[tokio::test]
async fn a_fresh_ensure_checks_the_document_namespace_once() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    let surface = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            channel_receipt(),
            surface_id(),
            String::new(),
        )
        .await
        .unwrap();

    assert_eq!(surface.state, SurfaceState::Ready);
    assert_eq!(repo.document_lookups.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn ensure_refuses_an_id_that_already_has_a_session() {
    let repo = Arc::new(MemRepo::default());
    let mut init = MockSurfaceInitializer::new();
    // The id has a session no surface created; it must never be initialized
    // over (the initializer would report it as already initialized).
    init.expect_session_exists()
        .returning(|_| Box::pin(async { Ok(true) }));
    let svc = service_with(repo.clone(), init);

    let err = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            channel_receipt(),
            surface_id(),
            String::new(),
        )
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::IdReserved));
    // Refused before anything is written.
    assert!(repo.stored().is_none());
}

#[tokio::test]
async fn mint_token_refuses_a_ready_surface_whose_id_names_a_document() {
    let id = surface_id();
    // A ready binding to a document's id, as written before ids were reserved.
    let repo = MemRepo::holding(CollabSurface {
        state: SurfaceState::Ready,
        ..pending_surface(id)
    });
    repo.document_ids.store(true, Ordering::SeqCst);
    let svc = service_with(repo, MockSurfaceInitializer::new());

    let err = svc
        .mint_token(&user("macro|a@b.c"), channel_receipt(), id)
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::IdReserved));
}

#[tokio::test]
async fn ensure_on_a_deleted_id_is_gone_even_though_its_session_remains() {
    let id = surface_id();
    // Deletion leaves the surface's sync-service session behind.
    let repo = MemRepo::holding(CollabSurface {
        state: SurfaceState::Ready,
        ..pending_surface(id)
    });
    repo.soft_deleted.store(true, Ordering::SeqCst);
    let mut init = MockSurfaceInitializer::new();
    init.expect_session_exists()
        .returning(|_| Box::pin(async { Ok(true) }));
    let svc = service_with(repo, init);

    let err = svc
        .ensure_surface(&user("macro|a@b.c"), channel_receipt(), id, String::new())
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::Gone));
}
