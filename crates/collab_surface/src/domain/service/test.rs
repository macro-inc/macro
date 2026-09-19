use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use entity_access::domain::models::{
    AnyEntityPermission, EntityAccessReceipt, EntityPermission, ParticipantRole,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;

use super::*;
use crate::domain::ports::MockSurfaceInitializer;

const SECRET: &str = "test-secret";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

fn surface_id() -> Uuid {
    macro_uuid::generate_uuid_v7()
}

fn receipt_for(
    user_id: &str,
    entity_type: EntityType,
    entity_id: &str,
    permission: EntityPermission,
) -> EntityAccessReceipt<AnyEntityPermission> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        entity_access::domain::models::Entity {
            entity_id: entity_id.to_string(),
            entity_type,
        },
        permission,
    )
    .unwrap()
}

fn edit_permission() -> EntityPermission {
    EntityPermission::AccessLevel {
        access_level: AccessLevel::Edit,
    }
}

/// In-memory repo: one optional surface plus operation flags.
#[derive(Default)]
struct MemRepo {
    surface: std::sync::Mutex<Option<CollabSurface>>,
    soft_deleted: AtomicBool,
}

#[derive(Debug, thiserror::Error)]
#[error("mem repo error")]
struct MemErr;

impl CollabSurfaceRepo for Arc<MemRepo> {
    type Err = MemErr;

    async fn insert(&self, surface: &CollabSurface) -> Result<bool, MemErr> {
        let mut slot = self.surface.lock().unwrap();
        // A row exists (live or soft-deleted) -> conflict, no insert.
        if slot.is_some() {
            return Ok(false);
        }
        *slot = Some(surface.clone());
        Ok(true)
    }

    async fn get(&self, id: Uuid) -> Result<Option<CollabSurface>, MemErr> {
        Ok(self
            .surface
            .lock()
            .unwrap()
            .clone()
            .filter(|s| s.id == id && !self.soft_deleted.load(Ordering::SeqCst)))
    }

    async fn list_by_parent(&self, _parent: &Entity<'_>) -> Result<Vec<CollabSurface>, MemErr> {
        Ok(self.surface.lock().unwrap().clone().into_iter().collect())
    }

    async fn mark_ready(&self, _id: Uuid) -> Result<(), MemErr> {
        if let Some(s) = self.surface.lock().unwrap().as_mut() {
            s.state = SurfaceState::Ready;
        }
        Ok(())
    }

    async fn soft_delete(&self, _id: Uuid) -> Result<(), MemErr> {
        self.soft_deleted.store(true, Ordering::SeqCst);
        Ok(())
    }
}

fn service_with(
    repo: Arc<MemRepo>,
    initializer: MockSurfaceInitializer,
) -> CollabSurfaceServiceImpl<Arc<MemRepo>, MockSurfaceInitializer> {
    CollabSurfaceServiceImpl::new(Arc::new(repo), Arc::new(initializer), SECRET.to_string())
}

#[tokio::test]
async fn ensure_creates_initializes_then_marks_ready() {
    let repo = Arc::new(MemRepo::default());
    let mut init = MockSurfaceInitializer::new();
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
    let mut init = MockSurfaceInitializer::new();
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
    let mut init = MockSurfaceInitializer::new();
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
    let mut init = MockSurfaceInitializer::new();
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
    let mut init = MockSurfaceInitializer::new();
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
async fn mint_token_maps_channel_role_to_edit() {
    let repo = Arc::new(MemRepo::default());
    let mut init = MockSurfaceInitializer::new();
    init.expect_initialize()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo, init);

    let channel_role = EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    };
    let create_receipt = receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        channel_role.clone(),
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
    let mut init = MockSurfaceInitializer::new();
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
    let mut init = MockSurfaceInitializer::new();
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
