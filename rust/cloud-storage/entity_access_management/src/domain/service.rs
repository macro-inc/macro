//! Entity access management service implementation.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
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

impl<R> EntityAccessManagementServiceImpl<R>
where
    R: EntityAccessManagementRepository,
{
    /// Create a new entity access management service.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> EntityAccessManagementService for EntityAccessManagementServiceImpl<R>
where
    R: EntityAccessManagementRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        owner_id: &MacroUserId<Lowercase<'_>>,
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
        owner_id: &MacroUserId<Lowercase<'_>>,
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
}
