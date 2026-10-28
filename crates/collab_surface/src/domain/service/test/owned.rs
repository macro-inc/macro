//! Surfaces an initiative owns, and what the public API may do to them.

use super::*;

#[tokio::test]
async fn an_owned_surface_is_created_ready_from_its_markdown_and_ensured_idempotently() {
    let repo = Arc::new(MemRepo::default());
    let id = surface_id();
    let mut init = no_sessions();
    init.expect_initialize()
        .withf(move |session, markdown| session == id.to_string() && markdown == "# Plan")
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    let surface = svc
        .ensure_owned_surface(initiative_parent(id), id, "# Plan".to_string())
        .await
        .unwrap();
    assert_eq!(surface.id, id);
    assert_eq!(surface.parent, initiative_parent(id));
    assert_eq!(surface.state, SurfaceState::Ready);

    // A second ensure keeps the existing content: no second initialization.
    let again = svc
        .ensure_owned_surface(initiative_parent(id), id, "# Other".to_string())
        .await
        .unwrap();
    assert_eq!(again.state, SurfaceState::Ready);
    assert_eq!(
        repo.stored().map(|stored| stored.state),
        Some(SurfaceState::Ready)
    );
}

#[tokio::test]
async fn an_owned_surface_follows_the_shared_ensure_rules() {
    let repo = Arc::new(MemRepo::default());
    repo.document_ids.store(true, Ordering::SeqCst);
    let svc = service_with(repo.clone(), no_sessions());
    let id = surface_id();

    let err = svc
        .ensure_owned_surface(initiative_parent(id), id, String::new())
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::IdReserved));
    assert!(repo.stored().is_none());
}

#[tokio::test]
async fn retiring_an_owned_surface_soft_deletes_it() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_initiative_surface(id));
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    svc.retire_surface(id).await.unwrap();
    svc.retire_surface(id).await.unwrap();

    assert!(repo.soft_deleted.load(Ordering::SeqCst));
    assert!(matches!(
        svc.get_parent(id).await.unwrap_err(),
        CollabSurfaceError::NotFound
    ));
}

#[tokio::test]
async fn the_public_api_never_ensures_or_deletes_an_owned_surface() {
    let id = surface_id();

    let empty = Arc::new(MemRepo::default());
    let svc = service_with(empty.clone(), MockSurfaceInitializer::new());
    let err = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            initiative_receipt(id),
            id,
            String::new(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
    assert!(empty.stored().is_none());

    let repo = MemRepo::holding(ready_initiative_surface(id));
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());
    let err = svc
        .delete_surface(&user("macro|a@b.c"), initiative_receipt(id), id)
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
    assert!(!repo.soft_deleted.load(Ordering::SeqCst));
}

#[tokio::test]
async fn the_public_api_mints_tokens_for_an_owned_surface() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_initiative_surface(id));
    let svc = service_with(repo, MockSurfaceInitializer::new());

    let token = svc
        .mint_token(&user("macro|a@b.c"), initiative_receipt(id), id)
        .await
        .unwrap();
    let claims: model::document::DocumentPermissionsToken =
        macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
    assert_eq!(claims.document_id, id.to_string());
    assert_eq!(claims.access_level, AccessLevel::Edit);
}
