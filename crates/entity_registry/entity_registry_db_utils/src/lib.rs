#![deny(missing_docs)]
//! Transactional writes to the `entity` table.
//!
//! Other crates call these helpers from inside their own resource-row
//! transactions. The helpers never commit. Reads go through
//! `entity_registry::EntityRegistryService`. Shared types live in
//! `shared_entity_registry`. [`OwnedEntityRegistrar`] applies the registry's
//! domain owner-grant policy alongside the row write in the caller's transaction.

#[cfg(test)]
mod test;

mod owned;
pub use owned::OwnedEntityRegistrar;

use chrono::{DateTime, Utc};
use model_owner::{Owner, OwnerType};
use rootcause::prelude::*;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub use shared_entity_registry::{
    EntityRegistryError, EntityRegistryResult, InsertOutcome, NewEntityRecord,
    RegisteredEntityType, WriteOutcome,
};

fn bind_owner(owner: &Owner) -> (OwnerType, String) {
    (owner.owner_type(), owner.principal_id())
}

/// Register `record`. Idempotent: `ON CONFLICT (id) DO NOTHING`.
#[tracing::instrument(
    skip_all,
    fields(entity.id = %record.id, entity.kind = %record.entity_type),
    err
)]
pub async fn insert_entity(
    tx: &mut Transaction<'_, Postgres>,
    record: NewEntityRecord,
) -> EntityRegistryResult<InsertOutcome> {
    let (owner_type, owner_id) = bind_owner(&record.owner);
    let result = sqlx::query!(
        r#"
        INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), COALESCE($6::timestamptz, now()))
        ON CONFLICT (id) DO NOTHING
        "#,
        record.id,
        record.entity_type.as_str(),
        owner_type as _,
        owner_id,
        record.created_at,
        record.updated_at,
    )
    .execute(tx.as_mut())
    .await
    .context(EntityRegistryError::Infrastructure)?;

    if result.rows_affected() == 1 {
        Ok(InsertOutcome::Inserted)
    } else {
        Ok(InsertOutcome::AlreadyRegistered)
    }
}

/// Set `deleted_at = at`. Last write wins.
#[tracing::instrument(skip(tx), err)]
pub async fn mark_deleted(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    at: DateTime<Utc>,
) -> EntityRegistryResult<WriteOutcome> {
    write_by_id(
        sqlx::query!(
            r#"
            UPDATE entity SET deleted_at = $2 WHERE id = $1
            "#,
            id,
            at,
        )
        .execute(tx.as_mut())
        .await,
    )
}

/// Set `deleted_at = NULL`. The restore mirror of [`mark_deleted`].
#[tracing::instrument(skip(tx), err)]
pub async fn clear_deleted(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> EntityRegistryResult<WriteOutcome> {
    write_by_id(
        sqlx::query!(
            r#"
            UPDATE entity SET deleted_at = NULL WHERE id = $1
            "#,
            id,
        )
        .execute(tx.as_mut())
        .await,
    )
}

/// Set `updated_at = at`.
#[tracing::instrument(skip(tx), err)]
pub async fn touch_updated(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    at: DateTime<Utc>,
) -> EntityRegistryResult<WriteOutcome> {
    write_by_id(
        sqlx::query!(
            r#"
            UPDATE entity SET updated_at = $2 WHERE id = $1
            "#,
            id,
            at,
        )
        .execute(tx.as_mut())
        .await,
    )
}

/// Remove the row.
#[tracing::instrument(skip(tx), err)]
pub async fn delete_entity(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> EntityRegistryResult<WriteOutcome> {
    write_by_id(
        sqlx::query!(
            r#"
            DELETE FROM entity WHERE id = $1
            "#,
            id,
        )
        .execute(tx.as_mut())
        .await,
    )
}

fn write_by_id(
    result: Result<sqlx::postgres::PgQueryResult, sqlx::Error>,
) -> EntityRegistryResult<WriteOutcome> {
    let result = result.context(EntityRegistryError::Infrastructure)?;
    if result.rows_affected() == 1 {
        Ok(WriteOutcome::Applied)
    } else {
        Ok(WriteOutcome::NotFound)
    }
}
