//! Port definitions for entity access management.
//!
//! These traits define the contracts that adapters must implement.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
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
}

/// Service for managing entity access.
pub trait EntityAccessManagementService: Clone + Send + Sync + 'static {
    /// Updates entity access when an entity is **added** to a project
    fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        owner_id: &MacroUserId<Lowercase<'_>>,
        project_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), EntityAccessManagementError>> + Send;

    /// Updates entity access when an entity is **removed** from a project
    fn remove_entity_from_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        owner_id: &MacroUserId<Lowercase<'_>>,
        old_project_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), EntityAccessManagementError>> + Send;
}
