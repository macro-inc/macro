//! Entity access management service implementation.

use model_entity::EntityType;

use crate::domain::{
    models::EntityAccessManagementError,
    ports::{EntityAccessManagementRepository, EntityAccessManagementService},
};

/// Implementation of the [`EntityAccessManagementService`]
#[derive(Clone)]
pub struct EntityAccessManagementServiceImpl<R> {
    repo: R,
}

impl<R: EntityAccessManagementRepository> EntityAccessManagementServiceImpl<R> {
    /// Create a new entity access management service.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: EntityAccessManagementRepository> EntityAccessManagementService
    for EntityAccessManagementServiceImpl<R>
{
    #[tracing::instrument(skip(self), err)]
    async fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        project_id: &uuid::Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        if !entity_type.is_valid_entity_access_entity() {
            return Err(EntityAccessManagementError::UnsupportedEntityType(
                entity_type,
            ));
        }

        self.repo
            .add_entity_to_project(entity_id, entity_type, project_id)
            .await
            .map_err(|e| EntityAccessManagementError::DatabaseError(e.into()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_entity_from_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        old_project_id: &uuid::Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        if !entity_type.is_valid_entity_access_entity() {
            return Err(EntityAccessManagementError::UnsupportedEntityType(
                entity_type,
            ));
        }

        self.repo
            .remove_entity_from_project(entity_id, entity_type, old_project_id)
            .await
            .map_err(|e| EntityAccessManagementError::DatabaseError(e.into()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn move_project(
        &self,
        project_id: &uuid::Uuid,
        old_project_id: Option<&uuid::Uuid>,
        new_project_id: Option<&uuid::Uuid>,
    ) -> Result<(), EntityAccessManagementError> {
        match (old_project_id, new_project_id) {
            // cannot both be the same
            (Some(old_project_id), Some(new_project_id)) if old_project_id.eq(new_project_id) => {
                return Err(EntityAccessManagementError::InvalidProjectMove);
            }
            // cannot both be empty
            (None, None) => {
                return Err(EntityAccessManagementError::InvalidProjectMove);
            }
            _ => {}
        }

        self.repo
            .move_project(project_id, old_project_id, new_project_id)
            .await
            .map_err(|e| EntityAccessManagementError::DatabaseError(e.into()))
    }
}
