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

mod ensure;
mod form_ids;
mod form_surfaces;
mod namespace;
mod owned;
mod owned_state;
mod tokens;

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
/// for the document namespace and the forms domain's ids.
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
    /// The ids that name a form, live or trashed.
    form_ids: std::sync::Mutex<Vec<Uuid>>,
    /// How many times the forms domain's ids were consulted.
    form_lookups: AtomicUsize,
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

impl FormIds for Arc<MemRepo> {
    async fn is_form_id(&self, id: Uuid) -> Result<bool, rootcause::Report> {
        self.form_lookups.fetch_add(1, Ordering::SeqCst);
        Ok(self.form_ids.lock().unwrap().contains(&id))
    }
}

type TestService =
    CollabSurfaceServiceImpl<Arc<MemRepo>, MockSurfaceInitializer, Arc<MemRepo>, Arc<MemRepo>>;

fn service_with(repo: Arc<MemRepo>, initializer: MockSurfaceInitializer) -> TestService {
    CollabSurfaceServiceImpl::new(
        Arc::new(repo.clone()),
        Arc::new(initializer),
        Arc::new(repo.clone()),
        SECRET.to_string(),
    )
    .with_form_ids(Arc::new(repo))
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

fn form_parent(id: Uuid) -> Entity<'static> {
    EntityType::Form.with_entity_string(id.to_string())
}

fn form_receipt(id: Uuid, access_level: AccessLevel) -> EntityAccessReceipt<AnyEntityPermission> {
    receipt_for(
        "macro|a@b.c",
        EntityType::Form,
        &id.to_string(),
        EntityPermission::AccessLevel { access_level },
    )
}

/// A ready surface its parent form's domain owns, with the form's id.
fn ready_form_surface(id: Uuid) -> CollabSurface {
    let now = chrono::Utc::now();
    CollabSurface {
        id,
        parent: form_parent(id),
        state: SurfaceState::Ready,
        created_at: now,
        updated_at: now,
    }
}

/// The current unix time in seconds, for checking a token's expiry window.
fn unix_now() -> usize {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
}
