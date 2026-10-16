//! Reading and updating an owned surface's Loro state with service tokens.

use super::*;

#[tokio::test]
async fn an_owned_surface_snapshot_is_read_with_a_short_lived_view_service_token() {
    let form_id = uuid::Uuid::parse_str("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90").unwrap();
    let now = chrono::Utc::now();
    let repo = MemRepo::holding(CollabSurface {
        id: form_id,
        parent: EntityType::Form
            .with_entity_string("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90".to_string()),
        state: SurfaceState::Ready,
        created_at: now,
        updated_at: now,
    });
    let presented_token = Arc::new(std::sync::Mutex::new(None));
    let presented_token_in_mock = presented_token.clone();
    let mut init = MockSurfaceInitializer::new();
    init.expect_snapshot()
        .withf(|session, _| session == "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90")
        .times(1)
        .returning(move |_, token| {
            *presented_token_in_mock.lock().unwrap() = Some(token.clone());
            Box::pin(async {
                Ok(SurfaceSnapshot {
                    snapshot: vec![0x6c, 0x6f, 0x72, 0x6f],
                    revision: vec![1, 2],
                })
            })
        });
    let svc = service_with(repo, init);
    let before = unix_now();

    let snapshot = svc
        .owned_surface_snapshot(
            EntityType::Form.with_entity_string("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90".to_string()),
            form_id,
        )
        .await
        .unwrap();

    assert_eq!(
        snapshot,
        SurfaceSnapshot {
            snapshot: vec![0x6c, 0x6f, 0x72, 0x6f],
            revision: vec![1, 2],
        }
    );
    let token = presented_token.lock().unwrap().clone().unwrap();
    let claims: serde_json::Value = macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
    let expires_at = claims["exp"].as_u64().unwrap() as usize;
    assert!(
        expires_at > before && expires_at <= unix_now() + 60,
        "{expires_at} outside ({before}, now + 60]"
    );
    assert_eq!(
        claims,
        serde_json::json!({
            "document_id": "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            "access_level": "view",
            "exp": expires_at,
            "iss": "document_storage_service",
        }),
        "a service token impersonates no user"
    );
}

#[tokio::test]
async fn an_owned_surface_update_is_applied_with_a_short_lived_edit_service_token() {
    let form_id = uuid::Uuid::parse_str("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90").unwrap();
    let now = chrono::Utc::now();
    let repo = MemRepo::holding(CollabSurface {
        id: form_id,
        parent: EntityType::Form
            .with_entity_string("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90".to_string()),
        state: SurfaceState::Ready,
        created_at: now,
        updated_at: now,
    });
    let presented_token = Arc::new(std::sync::Mutex::new(None));
    let presented_token_in_mock = presented_token.clone();
    let mut init = MockSurfaceInitializer::new();
    init.expect_update()
        .withf(|session, _, expected_revision, update| {
            session == "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90"
                && expected_revision == [1, 2]
                && update == [3, 4, 5]
        })
        .times(1)
        .returning(move |_, token, _, _| {
            *presented_token_in_mock.lock().unwrap() = Some(token.clone());
            Box::pin(async {
                Ok(SurfaceUpdate::Applied {
                    revision: vec![1, 3],
                })
            })
        });
    let svc = service_with(repo, init);
    let before = unix_now();

    let outcome = svc
        .update_owned_surface(
            EntityType::Form.with_entity_string("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90".to_string()),
            form_id,
            vec![1, 2],
            vec![3, 4, 5],
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        SurfaceUpdate::Applied {
            revision: vec![1, 3]
        }
    );
    let token = presented_token.lock().unwrap().clone().unwrap();
    let claims: serde_json::Value = macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
    let expires_at = claims["exp"].as_u64().unwrap() as usize;
    assert!(
        expires_at > before && expires_at <= unix_now() + 60,
        "{expires_at} outside ({before}, now + 60]"
    );
    assert_eq!(
        claims,
        serde_json::json!({
            "document_id": "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            "access_level": "edit",
            "exp": expires_at,
            "iss": "document_storage_service",
        }),
        "a service token impersonates no user"
    );
}

#[tokio::test]
async fn a_stale_owned_surface_update_is_a_conflict() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    let mut init = MockSurfaceInitializer::new();
    init.expect_update()
        .times(1)
        .returning(|_, _, _, _| Box::pin(async { Ok(SurfaceUpdate::Conflict) }));
    let svc = service_with(repo, init);

    let outcome = svc
        .update_owned_surface(form_parent(id), id, vec![1], vec![2])
        .await
        .unwrap();

    assert_eq!(outcome, SurfaceUpdate::Conflict);
}

#[tokio::test]
async fn an_initiative_owns_its_surface_state_too() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_initiative_surface(id));
    let mut init = MockSurfaceInitializer::new();
    init.expect_snapshot().times(1).returning(|_, _| {
        Box::pin(async {
            Ok(SurfaceSnapshot {
                snapshot: vec![7],
                revision: vec![8],
            })
        })
    });
    let svc = service_with(repo, init);

    let snapshot = svc
        .owned_surface_snapshot(initiative_parent(id), id)
        .await
        .unwrap();

    assert_eq!(snapshot.snapshot, vec![7]);
}

/// Every refusal below happens before sync-service is reached: the bare
/// mock panics on any call.
#[tokio::test]
async fn owned_surface_state_refuses_a_surface_bound_to_another_parent() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    let svc = service_with(repo, MockSurfaceInitializer::new());
    let other_form = form_parent(surface_id());

    let read = svc
        .owned_surface_snapshot(other_form.clone(), id)
        .await
        .unwrap_err();
    let write = svc
        .update_owned_surface(other_form, id, vec![1], vec![2])
        .await
        .unwrap_err();

    assert!(matches!(read, CollabSurfaceError::AccessDenied), "{read:?}");
    assert!(
        matches!(write, CollabSurfaceError::AccessDenied),
        "{write:?}"
    );
}

#[tokio::test]
async fn owned_surface_state_refuses_a_parent_type_whose_domain_does_not_own_it() {
    let id = surface_id();
    // A caller-owned channel surface, named by its real parent.
    let now = chrono::Utc::now();
    let repo = MemRepo::holding(CollabSurface {
        id,
        parent: EntityType::Channel.with_entity_string("chan-1".to_string()),
        state: SurfaceState::Ready,
        created_at: now,
        updated_at: now,
    });
    let svc = service_with(repo, MockSurfaceInitializer::new());
    let channel = EntityType::Channel.with_entity_string("chan-1".to_string());

    let read = svc
        .owned_surface_snapshot(channel.clone(), id)
        .await
        .unwrap_err();
    let write = svc
        .update_owned_surface(channel, id, vec![1], vec![2])
        .await
        .unwrap_err();

    assert!(matches!(read, CollabSurfaceError::AccessDenied), "{read:?}");
    assert!(
        matches!(write, CollabSurfaceError::AccessDenied),
        "{write:?}"
    );
}

#[tokio::test]
async fn owned_surface_state_refuses_a_pending_surface_without_seeding_it() {
    let id = surface_id();
    let now = chrono::Utc::now();
    let repo = MemRepo::holding(CollabSurface {
        id,
        parent: form_parent(id),
        state: SurfaceState::Pending,
        created_at: now,
        updated_at: now,
    });
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    let read = svc
        .owned_surface_snapshot(form_parent(id), id)
        .await
        .unwrap_err();
    let write = svc
        .update_owned_surface(form_parent(id), id, vec![1], vec![2])
        .await
        .unwrap_err();

    assert!(matches!(read, CollabSurfaceError::NotReady), "{read:?}");
    assert!(matches!(write, CollabSurfaceError::NotReady), "{write:?}");
    assert_eq!(repo.stored().unwrap().state, SurfaceState::Pending);
}

#[tokio::test]
async fn owned_surface_state_refuses_a_missing_surface_without_creating_it() {
    let repo = Arc::new(MemRepo::default());
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());
    let id = surface_id();

    let read = svc
        .owned_surface_snapshot(form_parent(id), id)
        .await
        .unwrap_err();
    let write = svc
        .update_owned_surface(form_parent(id), id, vec![1], vec![2])
        .await
        .unwrap_err();

    assert!(matches!(read, CollabSurfaceError::NotFound), "{read:?}");
    assert!(matches!(write, CollabSurfaceError::NotFound), "{write:?}");
    assert!(repo.stored().is_none());
}

#[tokio::test]
async fn owned_surface_state_refuses_a_retired_surface() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    repo.soft_deleted.store(true, Ordering::SeqCst);
    let svc = service_with(repo, MockSurfaceInitializer::new());

    let read = svc
        .owned_surface_snapshot(form_parent(id), id)
        .await
        .unwrap_err();
    let write = svc
        .update_owned_surface(form_parent(id), id, vec![1], vec![2])
        .await
        .unwrap_err();

    assert!(matches!(read, CollabSurfaceError::NotFound), "{read:?}");
    assert!(matches!(write, CollabSurfaceError::NotFound), "{write:?}");
}

#[tokio::test]
async fn owned_surface_state_refuses_an_id_that_names_a_document() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_form_surface(id));
    repo.document_ids.store(true, Ordering::SeqCst);
    let svc = service_with(repo, MockSurfaceInitializer::new());

    let read = svc
        .owned_surface_snapshot(form_parent(id), id)
        .await
        .unwrap_err();
    let write = svc
        .update_owned_surface(form_parent(id), id, vec![1], vec![2])
        .await
        .unwrap_err();

    assert!(matches!(read, CollabSurfaceError::IdReserved), "{read:?}");
    assert!(matches!(write, CollabSurfaceError::IdReserved), "{write:?}");
}
