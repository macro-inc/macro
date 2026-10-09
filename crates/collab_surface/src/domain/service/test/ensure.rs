//! Ensuring caller-owned surfaces: creation, idempotence, pending retries and id rules.

use super::*;

#[tokio::test]
async fn ensure_creates_initializes_then_marks_ready() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let svc = service_with(repo.clone(), init);
    let receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        edit_permission(),
    );
    let id = surface_id();
    let surface = svc
        .ensure_surface(&user("macro|a@b.c"), receipt, id, "# hi".to_string())
        .await
        .unwrap();

    assert_eq!(surface.id, id);
    assert_eq!(surface.state, SurfaceState::Ready);
    assert_eq!(
        repo.surface.lock().unwrap().as_ref().unwrap().state,
        SurfaceState::Ready
    );
}

#[tokio::test]
async fn ensure_is_idempotent_for_a_ready_surface() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    // Exactly one initialization across both ensures: the second sees a
    // ready surface and does not touch the initializer.
    init.expect_initialize()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let svc = service_with(repo.clone(), init);
    let id = surface_id();
    let make_receipt = || {
        receipt_for(
            "macro|a@b.c",
            EntityType::Channel,
            "chan-1",
            edit_permission(),
        )
    };

    let first = svc
        .ensure_surface(&user("macro|a@b.c"), make_receipt(), id, "# hi".to_string())
        .await
        .unwrap();
    let second = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            make_receipt(),
            id,
            "# different seed, ignored".to_string(),
        )
        .await
        .unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(second.state, SurfaceState::Ready);
}

#[tokio::test]
async fn ensure_retries_init_for_a_pending_surface() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    // First ensure: init fails, row stays pending. Second ensure: init
    // succeeds and the surface becomes ready.
    let calls = Arc::new(AtomicUsize::new(0));
    let calls_in_mock = calls.clone();
    init.expect_initialize().times(2).returning(move |_, _| {
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
    let id = surface_id();
    let make_receipt = || {
        receipt_for(
            "macro|a@b.c",
            EntityType::Channel,
            "chan-1",
            edit_permission(),
        )
    };

    let err = svc
        .ensure_surface(&user("macro|a@b.c"), make_receipt(), id, String::new())
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::Internal(_)));
    // The row survives as pending — no unwind.
    assert_eq!(
        repo.surface.lock().unwrap().as_ref().unwrap().state,
        SurfaceState::Pending
    );

    let surface = svc
        .ensure_surface(&user("macro|a@b.c"), make_receipt(), id, String::new())
        .await
        .unwrap();
    assert_eq!(surface.state, SurfaceState::Ready);
}

#[tokio::test]
async fn ensure_maps_insert_conflict_on_deleted_id_to_gone() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));

    let svc = service_with(repo.clone(), init);
    let id = surface_id();
    let make_receipt = || {
        receipt_for(
            "macro|a@b.c",
            EntityType::Channel,
            "chan-1",
            edit_permission(),
        )
    };

    svc.ensure_surface(&user("macro|a@b.c"), make_receipt(), id, String::new())
        .await
        .unwrap();
    svc.delete_surface(&user("macro|a@b.c"), make_receipt(), id)
        .await
        .unwrap();

    let err = svc
        .ensure_surface(&user("macro|a@b.c"), make_receipt(), id, String::new())
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::Gone));
}

#[tokio::test]
async fn ensure_rejects_mismatched_parent() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo, init);
    let id = surface_id();

    let chan1_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        edit_permission(),
    );
    svc.ensure_surface(&user("macro|a@b.c"), chan1_receipt, id, String::new())
        .await
        .unwrap();

    // Ensuring the same id against a different parent must fail: the id is
    // bound to chan-1, and a receipt for chan-2 proves nothing about it.
    let chan2_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-2",
        edit_permission(),
    );
    let err = svc
        .ensure_surface(&user("macro|a@b.c"), chan2_receipt, id, String::new())
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
}

#[tokio::test]
async fn ensure_rejects_receipt_for_other_user() {
    let repo = Arc::new(MemRepo::default());
    let svc = service_with(repo, MockSurfaceInitializer::new());
    let receipt = receipt_for(
        "macro|other@b.c",
        EntityType::Channel,
        "chan-1",
        edit_permission(),
    );
    let err = svc
        .ensure_surface(&user("macro|a@b.c"), receipt, surface_id(), String::new())
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
}

#[tokio::test]
async fn a_pending_surface_whose_session_exists_heals_on_retry() {
    let repo = Arc::new(MemRepo::default());
    // The first ensure initializes the session, then fails to mark it ready.
    repo.mark_ready_failures.store(1, Ordering::SeqCst);
    let mut init = MockSurfaceInitializer::new();
    // Only the fresh ensure checks for a session; the retry trusts its row.
    init.expect_session_exists()
        .times(1)
        .returning(|_| Box::pin(async { Ok(false) }));
    // The retry finds the session the first ensure created, which the
    // initializer reports as success.
    init.expect_initialize()
        .times(2)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);
    let id = surface_id();

    svc.ensure_surface(&user("macro|a@b.c"), channel_receipt(), id, String::new())
        .await
        .unwrap_err();
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Pending);

    let surface = svc
        .ensure_surface(&user("macro|a@b.c"), channel_receipt(), id, String::new())
        .await
        .unwrap();
    assert_eq!(surface.state, SurfaceState::Ready);
}

#[tokio::test]
async fn concurrent_ensures_of_a_new_id_both_end_ready() {
    let repo = Arc::new(MemRepo::default());
    let mut init = MockSurfaceInitializer::new();
    // Both ensures pass the pre-insert checks before either inserts.
    let checked = Arc::new(AtomicUsize::new(0));
    init.expect_session_exists().times(2).returning(move |_| {
        let checked = checked.clone();
        Box::pin(async move {
            checked.fetch_add(1, Ordering::SeqCst);
            while checked.load(Ordering::SeqCst) < 2 {
                tokio::task::yield_now().await;
            }
            Ok(false)
        })
    });
    init.expect_initialize()
        .times(1..=2)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);
    let id = surface_id();

    let caller = user("macro|a@b.c");
    let (first, second) = tokio::join!(
        svc.ensure_surface(&caller, channel_receipt(), id, String::new()),
        svc.ensure_surface(&caller, channel_receipt(), id, String::new()),
    );

    // The loser re-reads the winner's row: no extra lookups, no `Gone`.
    assert_eq!(first.unwrap().state, SurfaceState::Ready);
    assert_eq!(second.unwrap().state, SurfaceState::Ready);
    assert_eq!(repo.document_lookups.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn ensure_accepts_random_ids() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .times(2)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    // v4, as a browser's crypto.randomUUID() makes, and v7.
    for id in [uuid::Uuid::new_v4(), surface_id()] {
        let surface = svc
            .ensure_surface(&user("macro|a@b.c"), channel_receipt(), id, String::new())
            .await
            .unwrap();
        assert_eq!(surface.state, SurfaceState::Ready);
        *repo.surface.lock().unwrap() = None;
    }
}

#[tokio::test]
async fn ensure_refuses_ids_that_are_not_random() {
    let repo = Arc::new(MemRepo::default());
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    for id in [
        uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, b"surface"),
        uuid::Uuid::nil(),
    ] {
        let err = svc
            .ensure_surface(&user("macro|a@b.c"), channel_receipt(), id, String::new())
            .await
            .unwrap_err();
        assert!(matches!(err, CollabSurfaceError::BadRequest(_)));
    }
    assert!(repo.stored().is_none());
    assert_eq!(repo.document_lookups.load(Ordering::SeqCst), 0);
}
