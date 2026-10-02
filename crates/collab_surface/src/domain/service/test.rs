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

/// In-memory repo: one optional surface plus operation flags. Also stands in
/// for the document namespace.
#[derive(Default)]
struct MemRepo {
    surface: std::sync::Mutex<Option<CollabSurface>>,
    soft_deleted: AtomicBool,
    /// Whether every id reads as naming an existing document.
    document_ids: AtomicBool,
    /// How many times the document namespace was consulted.
    document_lookups: AtomicUsize,
    /// How many upcoming `mark_ready` calls fail.
    mark_ready_failures: AtomicUsize,
}

impl MemRepo {
    /// A repo already holding `surface`, as an earlier ensure left it.
    fn holding(surface: CollabSurface) -> Arc<Self> {
        let repo = Arc::new(Self::default());
        *repo.surface.lock().unwrap() = Some(surface);
        repo
    }

    fn stored(&self) -> Option<CollabSurface> {
        self.surface.lock().unwrap().clone()
    }
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
        if self
            .mark_ready_failures
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
        {
            return Err(MemErr);
        }
        if let Some(s) = self.surface.lock().unwrap().as_mut() {
            s.state = SurfaceState::Ready;
        }
        Ok(())
    }

    async fn soft_delete(&self, _id: Uuid) -> Result<(), MemErr> {
        self.soft_deleted.store(true, Ordering::SeqCst);
        Ok(())
    }

    async fn is_deleted(&self, id: Uuid) -> Result<bool, MemErr> {
        Ok(self.soft_deleted.load(Ordering::SeqCst)
            && self
                .surface
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|s| s.id == id))
    }
}

impl DocumentIds for Arc<MemRepo> {
    async fn is_document_id(&self, _id: Uuid) -> Result<bool, rootcause::Report> {
        self.document_lookups.fetch_add(1, Ordering::SeqCst);
        Ok(self.document_ids.load(Ordering::SeqCst))
    }
}

type TestService = CollabSurfaceServiceImpl<Arc<MemRepo>, MockSurfaceInitializer, Arc<MemRepo>>;

fn service_with(repo: Arc<MemRepo>, initializer: MockSurfaceInitializer) -> TestService {
    CollabSurfaceServiceImpl::new(
        Arc::new(repo.clone()),
        Arc::new(initializer),
        Arc::new(repo),
        SECRET.to_string(),
    )
}

/// An initializer that finds no session under any id yet.
fn no_sessions() -> MockSurfaceInitializer {
    let mut init = MockSurfaceInitializer::new();
    init.expect_session_exists()
        .returning(|_| Box::pin(async { Ok(false) }));
    init
}

/// A pending surface an earlier ensure left behind.
fn pending_surface(id: Uuid) -> CollabSurface {
    let now = chrono::Utc::now();
    CollabSurface {
        id,
        parent: EntityType::Channel.with_entity_string("chan-1".to_string()),
        state: SurfaceState::Pending,
        created_at: now,
        updated_at: now,
    }
}

fn channel_receipt() -> EntityAccessReceipt<AnyEntityPermission> {
    receipt_for(
        "macro|a@b.c",
        EntityType::Channel,
        "chan-1",
        edit_permission(),
    )
}

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

fn initiative_parent(id: Uuid) -> Entity<'static> {
    EntityType::Initiative.with_entity_string(id.to_string())
}

fn initiative_receipt(id: Uuid) -> EntityAccessReceipt<AnyEntityPermission> {
    receipt_for(
        "macro|a@b.c",
        EntityType::Initiative,
        &id.to_string(),
        edit_permission(),
    )
}

/// A ready surface its parent initiative's domain owns, with the initiative's id.
fn ready_initiative_surface(id: Uuid) -> CollabSurface {
    let now = chrono::Utc::now();
    CollabSurface {
        id,
        parent: initiative_parent(id),
        state: SurfaceState::Ready,
        created_at: now,
        updated_at: now,
    }
}

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
