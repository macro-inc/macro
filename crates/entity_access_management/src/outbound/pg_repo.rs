//! PostgreSQL implementation of the EntityAccessManagementRepository trait.

#[cfg(test)]
mod test;

use entity_access_db_utils::project_inheritance::synchronize_entity;
use model_entity::EntityType;
use sqlx::PgPool;

use crate::domain::ports::EntityAccessManagementRepository;

/// PostgreSQL-backed implementation of [`EntityAccessManagementRepository`].
#[derive(Clone)]
pub struct PgRepository {
    pool: PgPool,
}

impl PgRepository {
    /// Create a new PgRepository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Legacy post-commit notifications reconcile persisted topology under the guard.
    /// New topology writers must instead acquire the guard before parent mutations
    /// and call the transaction-aware helper inside their metadata transaction.
    async fn synchronize(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        synchronize_entity(&mut transaction, entity_id, entity_type).await?;
        transaction.commit().await
    }
}

impl EntityAccessManagementRepository for PgRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        _project_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        self.synchronize(entity_id, entity_type).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_entity_from_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        _old_project_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        self.synchronize(entity_id, entity_type).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn move_project(
        &self,
        project_id: &uuid::Uuid,
        _old_project_id: Option<&uuid::Uuid>,
        _new_project_id: Option<&uuid::Uuid>,
    ) -> Result<(), Self::Err> {
        self.synchronize(project_id, EntityType::Project).await
    }
}
