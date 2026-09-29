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

    async fn internal_read_markdown(&self, _: Uuid) -> Result<String, CollabSurfaceError> {
        Err(CollabSurfaceError::NotReady)
    }
}

fn initiative() -> InitiativeId {
    InitiativeId::from_uuid(Uuid::from_u128(1))
}

#[tokio::test]
async fn new_descriptions_seed_markdown_under_the_initiative() {
    let fake = Arc::new(FakeSurfaces::default());
    let adapter = InitiativeDescriptionSurfacesAdapter::new(fake.clone());
    let id = DescriptionSurfaceId::generate();

    adapter
        .ensure(
            id,
            initiative(),
            DescriptionSeed::Markdown("# Goals".into()),
        )
        .await
        .unwrap();
    adapter.delete(id).await.unwrap();

    assert_eq!(
        *fake.ensured.lock().unwrap(),
        vec![(
            EntityType::Initiative.with_entity_string(initiative().to_string()),
            id.as_uuid(),
            SurfaceSeed::Markdown("# Goals".into()),
        )]
    );
    assert_eq!(*fake.deleted.lock().unwrap(), vec![id.as_uuid()]);
}

#[tokio::test]
async fn legacy_documents_are_adopted_only_under_their_own_id() {
    let fake = Arc::new(FakeSurfaces::default());
    let adapter = InitiativeDescriptionSurfacesAdapter::new(fake.clone());
    let document = DescriptionDocumentId::from_uuid(Uuid::now_v7());

    adapter
        .ensure(
            document.adopting_surface(),
            initiative(),
            DescriptionSeed::LegacyDocument(document),
        )
        .await
        .unwrap();
    assert_eq!(
        fake.ensured.lock().unwrap()[0].2,
        SurfaceSeed::AdoptDocumentSession
    );

    let error = adapter
        .ensure(
            DescriptionSurfaceId::generate(),
            initiative(),
            DescriptionSeed::LegacyDocument(document),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, InitiativeError::Internal(_)));
    assert_eq!(fake.ensured.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn unreadable_surfaces_are_internal_errors() {
    let adapter = InitiativeDescriptionSurfacesAdapter::new(Arc::new(FakeSurfaces::default()));
    let error = adapter
        .read_markdown(DescriptionSurfaceId::generate())
        .await
        .unwrap_err();
    assert!(matches!(error, InitiativeError::Internal(_)));
}
