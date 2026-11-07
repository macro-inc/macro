//! Public tokens and deletion for caller-owned surfaces.

use super::*;

#[tokio::test]
async fn mint_token_maps_channel_role_to_edit() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo, init);

    let channel_role = EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    };
    let create_receipt = receipt_for("macro|a@b.c", EntityType::Channel, "chan-1", channel_role);
    let surface = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            create_receipt,
            surface_id(),
            String::new(),
        )
        .await
        .unwrap();

    let mint_receipt = receipt_for("macro|a@b.c", EntityType::Channel, "chan-1", channel_role);
    let token = svc
        .mint_token(&user("macro|a@b.c"), mint_receipt, surface.id)
        .await
        .unwrap();

    let claims: model::document::DocumentPermissionsToken =
        macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
    assert_eq!(claims.document_id, surface.id.to_string());
    assert_eq!(claims.access_level, AccessLevel::Edit);
}

#[tokio::test]
async fn mint_token_rejects_receipt_for_wrong_parent() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo, init);

    let create_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        edit_permission(),
    );
    let surface = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            create_receipt,
            surface_id(),
            String::new(),
        )
        .await
        .unwrap();

    // Receipt proves access to a different channel than the surface's parent.
    let wrong_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-2",
        edit_permission(),
    );
    let err = svc
        .mint_token(&user("macro|a@b.c"), wrong_receipt, surface.id)
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));
}

#[tokio::test]
async fn delete_requires_edit_capable_permission() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    let create_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        edit_permission(),
    );
    let surface = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            create_receipt,
            surface_id(),
            String::new(),
        )
        .await
        .unwrap();

    // View-only presence cannot delete.
    let view_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        EntityPermission::ChannelViewOnly,
    );
    let err = svc
        .delete_surface(&user("macro|a@b.c"), view_receipt, surface.id)
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::AccessDenied));

    // Member can.
    let member_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
    );
    svc.delete_surface(&user("macro|a@b.c"), member_receipt, surface.id)
        .await
        .unwrap();

    // Deleted surfaces read as absent.
    let gone = svc.get_parent(surface.id).await.unwrap_err();
    assert!(matches!(gone, CollabSurfaceError::NotFound));
}

#[tokio::test]
async fn mint_token_refuses_a_pending_surface() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize().returning(|_, _| {
        Box::pin(async {
            Err(CollabSurfaceError::Internal(
                rootcause::Report::new(MemErr).into_dynamic(),
            ))
        })
    });
    let svc = service_with(repo.clone(), init);
    let id = surface_id();
    let receipt = || {
        receipt_for(
            "macro|a@b.c",
            EntityType::Channel,
            "chan-1",
            edit_permission(),
        )
    };

    svc.ensure_surface(&user("macro|a@b.c"), receipt(), id, String::new())
        .await
        .unwrap_err();
    assert_eq!(
        repo.surface.lock().unwrap().as_ref().unwrap().state,
        SurfaceState::Pending
    );

    // A pending row has not proven its session is its own.
    let err = svc
        .mint_token(&user("macro|a@b.c"), receipt(), id)
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::NotReady));
}

#[tokio::test]
async fn parent_comment_access_mints_a_read_only_token() {
    let repo = Arc::new(MemRepo::default());
    let mut init = no_sessions();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo, init);
    let id = surface_id();
    let receipt = |access_level| {
        receipt_for(
            "macro|a@b.c",
            EntityType::Document,
            "doc-1",
            EntityPermission::AccessLevel { access_level },
        )
    };
    svc.ensure_surface(
        &user("macro|a@b.c"),
        receipt(AccessLevel::Edit),
        id,
        String::new(),
    )
    .await
    .unwrap();

    for (parent, minted) in [
        (AccessLevel::View, AccessLevel::View),
        (AccessLevel::Comment, AccessLevel::View),
        (AccessLevel::Edit, AccessLevel::Edit),
        (AccessLevel::Owner, AccessLevel::Owner),
    ] {
        let token = svc
            .mint_token(&user("macro|a@b.c"), receipt(parent), id)
            .await
            .unwrap();
        let claims: model::document::DocumentPermissionsToken =
            macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
        assert_eq!(claims.document_id, id.to_string());
        assert_eq!(claims.access_level, minted, "{parent:?}");
    }
}
