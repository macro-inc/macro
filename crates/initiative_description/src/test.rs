use std::sync::Mutex;

use collab_surface::domain::models::{CollabSurface, SurfaceState};
use model_entity::Entity;
use uuid::Uuid;

use super::*;

/// Records the owned-surface calls the adapter makes.
#[derive(Default)]
struct FakeSurfaces {
    ensured: Mutex<Vec<(Entity<'static>, Uuid, String)>>,
    retired: Mutex<Vec<Uuid>>,
    markdown: Option<String>,
}

impl OwnedSurfaceService for FakeSurfaces {
    async fn ensure_owned_surface(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        initial_markdown: String,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        self.ensured
            .lock()
            .unwrap()
            .push((parent.clone(), id, initial_markdown));
        Ok(CollabSurface {
            id,
            parent,
            state: SurfaceState::Ready,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        })
    }

    async fn ensure_owned_surface_from_snapshot(
        &self,
        _parent: Entity<'static>,
        _id: Uuid,
        _snapshot: Vec<u8>,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        unreachable!("initiative descriptions are seeded from markdown")
    }

    async fn owned_surface_markdown(
        &self,
        _id: Uuid,
    ) -> Result<Option<String>, CollabSurfaceError> {
        Ok(self.markdown.clone())
    }

    async fn owned_surface_snapshot(
        &self,
        _parent: Entity<'static>,
        _id: Uuid,
    ) -> Result<collab_surface::domain::models::SurfaceSnapshot, CollabSurfaceError> {
        unreachable!("initiative descriptions are read as markdown")
    }

    async fn update_owned_surface(
        &self,
        _parent: Entity<'static>,
        _id: Uuid,
        _expected_revision: Vec<u8>,
        _update: Vec<u8>,
    ) -> Result<collab_surface::domain::models::SurfaceUpdate, CollabSurfaceError> {
        unreachable!("initiative descriptions are edited through sync-service sessions")
    }

    async fn retire_surface(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        self.retired.lock().unwrap().push(id);
        Ok(())
    }
}

#[tokio::test]
async fn the_surface_has_the_initiative_id_and_parent() {
    let fake = Arc::new(FakeSurfaces::default());
    let adapter = InitiativeDescriptionSurfacesAdapter::new(fake.clone());
    let initiative = InitiativeId::from_uuid(Uuid::now_v7());

    adapter
        .ensure(initiative, "# Plan".to_string())
        .await
        .unwrap();
    adapter.delete(initiative).await.unwrap();

    assert_eq!(
        *fake.ensured.lock().unwrap(),
        vec![(
            EntityType::Initiative.with_entity_string(initiative.to_string()),
            initiative.as_uuid(),
            "# Plan".to_string(),
        )]
    );
    assert_eq!(*fake.retired.lock().unwrap(), vec![initiative.as_uuid()]);
}

#[tokio::test]
async fn a_description_never_opened_reads_as_empty() {
    let initiative = InitiativeId::from_uuid(Uuid::now_v7());
    let written = InitiativeDescriptionSurfacesAdapter::new(Arc::new(FakeSurfaces {
        markdown: Some("# Plan".to_string()),
        ..Default::default()
    }));
    let unopened = InitiativeDescriptionSurfacesAdapter::new(Arc::new(FakeSurfaces::default()));

    assert_eq!(written.read(initiative).await.unwrap(), "# Plan");
    assert_eq!(unopened.read(initiative).await.unwrap(), "");
}

#[test]
fn expected_surface_states_are_client_errors() {
    for (error, expected) in [
        (CollabSurfaceError::NotFound, "not found"),
        (CollabSurfaceError::ParentNotFound, "not found"),
        (CollabSurfaceError::Gone, "not found"),
        (CollabSurfaceError::NotReady, "conflict"),
        (CollabSurfaceError::BadRequest("bad".into()), "bad request"),
        (CollabSurfaceError::AccessDenied, "unauthorized"),
        (CollabSurfaceError::IdReserved, "internal"),
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
