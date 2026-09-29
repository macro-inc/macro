use std::sync::Mutex;

use collab_surface::domain::models::{CollabSurface, SurfaceState};
use model_entity::Entity;
use uuid::Uuid;

use super::*;

/// Records the owned-surface calls the adapter makes.
#[derive(Default)]
struct FakeSurfaces {
    adopted: Mutex<Vec<(Entity<'static>, Uuid)>>,
    retired: Mutex<Vec<Uuid>>,
}

impl OwnedSurfaceService for FakeSurfaces {
    async fn adopt_document_session(
        &self,
        parent: Entity<'static>,
        id: Uuid,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        self.adopted.lock().unwrap().push((parent.clone(), id));
        Ok(CollabSurface {
            id,
            parent,
            state: SurfaceState::Ready,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        })
    }

    async fn retire_surface(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        self.retired.lock().unwrap().push(id);
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
        *fake.adopted.lock().unwrap(),
        vec![(
            EntityType::Initiative.with_entity_string(initiative().to_string()),
            document.as_uuid(),
        )]
    );
    assert_eq!(*fake.retired.lock().unwrap(), vec![document.as_uuid()]);
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
