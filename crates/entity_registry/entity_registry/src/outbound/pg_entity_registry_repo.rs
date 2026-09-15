//! Pool-backed implementation of [`EntityRegistryRepository`].

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use model_entity::EntityType;
use model_owner::{Owner, OwnerType};
use rootcause::Report;
use rootcause::prelude::*;
use shared_entity_registry::{EntityRegistryError, EntityRegistryResult, RegisteredEntityType};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{EntityRecord, EntityTypeCount};
use crate::domain::ports::EntityRegistryRepository;

/// Reads `entity` through a pool.
#[derive(Debug, Clone)]
pub struct PgEntityRegistryRepository {
    pool: PgPool,
}

impl PgEntityRegistryRepository {
    /// A repository over `pool`.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct EntityRow {
    id: Uuid,
    entity_type: String,
    owner_type: OwnerType,
    owner_id: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

impl EntityRow {
    fn into_record(self) -> EntityRegistryResult<EntityRecord> {
        let id = self.id;
        let owner = Owner::parse(self.owner_type, &self.owner_id).map_err(|_| corrupt_row(id))?;
        let entity_type = self
            .entity_type
            .parse::<EntityType>()
            .map_err(|_| corrupt_row(id))?;
        let entity_type =
            RegisteredEntityType::try_from(entity_type).map_err(|_| corrupt_row(id))?;
        Ok(EntityRecord {
            id,
            entity_type,
            owner,
            created_at: self.created_at,
            updated_at: self.updated_at,
            deleted_at: self.deleted_at,
        })
    }
}

fn corrupt_row(id: Uuid) -> Report<EntityRegistryError> {
    report!(EntityRegistryError::CorruptRow).attach(id)
}

impl EntityRegistryRepository for PgEntityRegistryRepository {
    #[tracing::instrument(skip(self), err)]
    async fn get(&self, id: Uuid) -> EntityRegistryResult<Option<EntityRecord>> {
        sqlx::query_as!(
            EntityRow,
            r#"
            SELECT id, entity_type, owner_type AS "owner_type: OwnerType", owner_id,
                   created_at, updated_at, deleted_at
            FROM entity
            WHERE id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
        .context(EntityRegistryError::Infrastructure)?
        .map(EntityRow::into_record)
        .transpose()
    }

    #[tracing::instrument(skip(self, ids), fields(count = ids.len()), err)]
    async fn get_many(&self, ids: &[Uuid]) -> EntityRegistryResult<Vec<EntityRecord>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        sqlx::query_as!(
            EntityRow,
            r#"
            SELECT id, entity_type, owner_type AS "owner_type: OwnerType", owner_id,
                   created_at, updated_at, deleted_at
            FROM entity
            WHERE id = ANY($1)
            "#,
            ids,
        )
        .fetch_all(&self.pool)
        .await
        .context(EntityRegistryError::Infrastructure)?
        .into_iter()
        .map(EntityRow::into_record)
        .collect()
    }

    #[tracing::instrument(skip(self, owner), fields(owner.kind = ?owner.owner_type()), err)]
    async fn list_owned_by(
        &self,
        owner: &Owner,
        entity_type: Option<RegisteredEntityType>,
    ) -> EntityRegistryResult<Vec<EntityRecord>> {
        let owner_type = owner.owner_type();
        let owner_id = owner.principal_id();
        let entity_type = entity_type.map(RegisteredEntityType::as_str);
        sqlx::query_as!(
            EntityRow,
            r#"
            SELECT id, entity_type, owner_type AS "owner_type: OwnerType", owner_id,
                   created_at, updated_at, deleted_at
            FROM entity
            WHERE owner_type = $1 AND owner_id = $2
              AND deleted_at IS NULL
              AND ($3::text IS NULL OR entity_type = $3)
            ORDER BY created_at DESC, id DESC
            "#,
            owner_type as _,
            owner_id,
            entity_type,
        )
        .fetch_all(&self.pool)
        .await
        .context(EntityRegistryError::Infrastructure)?
        .into_iter()
        .map(EntityRow::into_record)
        .collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn count_by_type(
        &self,
        entity_type: RegisteredEntityType,
    ) -> EntityRegistryResult<EntityTypeCount> {
        let row = sqlx::query!(
            r#"
            SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS "live!",
                   count(*) FILTER (WHERE deleted_at IS NOT NULL) AS "deleted!"
            FROM entity WHERE entity_type = $1
            "#,
            entity_type.as_str(),
        )
        .fetch_one(&self.pool)
        .await
        .context(EntityRegistryError::Infrastructure)?;

        Ok(EntityTypeCount {
            live: as_count(row.live),
            deleted: as_count(row.deleted),
        })
    }
}

fn as_count(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}
