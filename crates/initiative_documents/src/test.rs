use std::sync::Mutex;

use chrono::Utc;
use collab_surface::domain::models::{CollabSurface, SurfaceState};
use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use super::*;

/// Records the internal calls; the caller-facing entry points are never used here.
#[derive(Default)]
struct FakeSurfaces {
    ensured: Mutex<Vec<(Entity<'static>, Uuid, SurfaceSeed)>>,
    deleted: Mutex<Vec<Uuid>>,
}

impl CollabSurfaceService for FakeSurfaces {
    async fn ensure_surface(
        &self,
        _: &MacroUserIdStr<'_>,
        _: EntityAccessReceipt<AnyEntityPermission>,
        _: Uuid,
        _: String,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        unreachable!("initiatives never ensure through a caller-chosen id")
    }

    async fn get_surface(
        &self,
        _: &MacroUserIdStr<'_>,
        _: EntityAccessReceipt<AnyEntityPermission>,
        _: Uuid,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        unreachable!()
    }

    async fn get_parent(&self, _: Uuid) -> Result<Entity<'static>, CollabSurfaceError> {
        unreachable!()
    }

    async fn mint_token(
        &self,
        _: &MacroUserIdStr<'_>,
        _: EntityAccessReceipt<AnyEntityPermission>,
        _: Uuid,
    ) -> Result<DocumentPermissionToken, CollabSurfaceError> {
        unreachable!()
    }

    async fn delete_surface(
        &self,
        _: &MacroUserIdStr<'_>,
        _: EntityAccessReceipt<AnyEntityPermission>,
        _: Uuid,
    ) -> Result<(), CollabSurfaceError> {
        unreachable!()
    }

    async fn internal_ensure_surface(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        seed: SurfaceSeed,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        self.ensured
            .lock()
            .unwrap()
            .push((parent.clone(), id, seed));
        Ok(CollabSurface {
            id,
            parent,
            state: SurfaceState::Ready,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
    }

    async fn internal_delete_surface(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        self.deleted.lock().unwrap().push(id);
        Ok(())
    }
}

fn initiative() -> InitiativeId {
    InitiativeId::from_uuid(Uuid::from_u128(1))
}

#[tokio::test]
async fn adoption_binds_the_document_session_to_the_initiative_surface() {
    let fake = Arc::new(FakeSurfaces::default());
    let adapter = InitiativeDescriptionSurfacesAdapter::new(fake.clone());
    let document = DescriptionDocumentId::from_uuid(Uuid::now_v7());

    adapter.adopt(document, initiative()).await.unwrap();
    adapter.delete(document.adopting_surface()).await.unwrap();

    assert_eq!(
        *fake.ensured.lock().unwrap(),
        vec![(
            EntityType::Initiative.with_entity_string(initiative().to_string()),
            document.as_uuid(),
            SurfaceSeed::AdoptDocumentSession,
        )]
    );
    assert_eq!(*fake.deleted.lock().unwrap(), vec![document.as_uuid()]);
}

#[test]
fn expected_surface_states_are_client_errors() {
    for (error, expected) in [
        (CollabSurfaceError::NotFound, "not found"),
        (CollabSurfaceError::ParentNotFound, "not found"),
        (CollabSurfaceError::Gone, "not found"),
        (CollabSurfaceError::NotReady, "conflict"),
        (CollabSurfaceError::IdReserved, "conflict"),
        (CollabSurfaceError::BadRequest("bad".into()), "bad request"),
        (CollabSurfaceError::AccessDenied, "unauthorized"),
        (
            CollabSurfaceError::Internal(rootcause::report!("boom").into_dynamic()),
            "internal",
        ),
    ] {
        let mapped = match map_surface_error(error) {
            InitiativeError::NotFound => "not found",
            InitiativeError::Conflict(_) => "conflict",
            InitiativeError::BadRequest(_) => "bad request",
            InitiativeError::Unauthorized => "unauthorized",
            InitiativeError::Internal(_) => "internal",
            other => panic!("unexpected mapping {other:?}"),
        };
        assert_eq!(mapped, expected);
    }
}
