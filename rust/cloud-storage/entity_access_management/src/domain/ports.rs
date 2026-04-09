//! Port definitions for entity access management.
//!
//! These traits define the contracts that adapters must implement.

use model_entity::EntityType;

use crate::domain::models::EntityAccessManagementError;

/// Repository for persisting entity_access in the database.
pub trait EntityAccessManagementRepository: Clone + Send + Sync + 'static {
    /// The error type returned by repository operations
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Updates entity access when an entity is **added** to a project
    fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        project_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Updates entity access when an entity is **removed** from a project
    fn remove_entity_from_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        old_project_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Updates entity access when a project is moved from one location to another
    fn move_project(
        &self,
        project_id: &uuid::Uuid,
        old_project_id: Option<&uuid::Uuid>,
        new_project_id: Option<&uuid::Uuid>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Service for managing entity access.
pub trait EntityAccessManagementService: Clone + Send + Sync + 'static {
    /// Updates entity access when an entity is **added** to a project
    fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        project_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), EntityAccessManagementError>> + Send;

    /// Updates entity access when an entity is **removed** from a project
    fn remove_entity_from_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        old_project_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), EntityAccessManagementError>> + Send;

    /// Updates entity access when a project is moved from one location to another
    fn move_project(
        &self,
        project_id: &uuid::Uuid,
        old_project_id: Option<&uuid::Uuid>,
        new_project_id: Option<&uuid::Uuid>,
    ) -> impl Future<Output = Result<(), EntityAccessManagementError>> + Send;
}
