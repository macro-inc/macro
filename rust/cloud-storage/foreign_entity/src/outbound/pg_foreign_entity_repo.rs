//! PostgreSQL implementation of the [`ForeignEntityRepository`] port.

#[cfg(test)]
mod tests;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity};
use crate::domain::ports::ForeignEntityRepository;

/// PostgreSQL-backed foreign entity repository.
#[derive(Clone)]
pub struct PgForeignEntityRepo {
    pool: PgPool,
}

impl PgForeignEntityRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ForeignEntityRepository for PgForeignEntityRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_foreign_entity_by_id(&self, id: Uuid) -> Result<Option<ForeignEntity>, Self::Err> {
        sqlx::query_as!(
            ForeignEntity,
            r#"
            SELECT
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM foreign_entity
            WHERE id = $1
            LIMIT 1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        sqlx::query_as!(
            ForeignEntity,
            r#"
            SELECT
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM foreign_entity
            WHERE foreign_entity_id = $1
              AND ($2::text IS NULL OR foreign_entity_source = $2)
            ORDER BY created_at ASC, id ASC
            "#,
            foreign_entity_id,
            foreign_entity_source,
        )
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self, create))]
    async fn create_foreign_entity(
        &self,
        id: Uuid,
        create: CreateForeignEntity,
    ) -> Result<ForeignEntity, Self::Err> {
        sqlx::query_as!(
            ForeignEntity,
            r#"
            INSERT INTO foreign_entity (
                id,
                foreign_entity_id,
                foreign_entity_source,
                metadata,
                stored_for_id,
                stored_for_auth_entity
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            id,
            create.foreign_entity_id,
            create.foreign_entity_source,
            create.metadata,
            create.stored_for_id,
            create.stored_for_auth_entity,
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_foreign_entity(&self, id: Uuid) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM foreign_entity
            WHERE id = $1
            "#,
            id,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self, patch))]
    async fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> Result<Option<ForeignEntity>, Self::Err> {
        let PatchForeignEntity {
            foreign_entity_id,
            foreign_entity_source,
            metadata,
            stored_for_id,
            stored_for_auth_entity,
        } = patch;

        sqlx::query_as!(
            ForeignEntity,
            r#"
            UPDATE foreign_entity
            SET foreign_entity_id = COALESCE($2::text, foreign_entity_id),
                foreign_entity_source = COALESCE($3::text, foreign_entity_source),
                metadata = COALESCE($4::jsonb, metadata),
                stored_for_id = COALESCE($5::text, stored_for_id),
                stored_for_auth_entity = COALESCE($6::text, stored_for_auth_entity),
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            id,
            foreign_entity_id,
            foreign_entity_source,
            metadata,
            stored_for_id,
            stored_for_auth_entity,
        )
        .fetch_optional(&self.pool)
        .await
    }
}
