//! Writes to `entity` that ride the caller's transaction.
//!
//! These are the public write API of the crate and the only sanctioned way
//! to change the table from outside it (CS-27). Every helper:
//!
//! - takes `&mut Transaction<'_, Postgres>` because the caller is mid-write on
//!   its own resource table and both rows must commit or roll back together;
//! - never commits;
//! - writes exactly the column(s) it is named for, mirroring what the caller's
//!   resource row did, so no helper hides a coupled side effect;
//! - reports what it did as a value, and treats "no such row" as an outcome,
//!   not an error (see [`WriteOutcome`]).
//!
//! Spans skip the record: an `Owner::User` is an email address, and the id
//! plus kind are enough to find the row.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use rootcause::prelude::*;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::bind_owner;
use crate::domain::models::{
    EntityRegistryError, EntityRegistryResult, InsertOutcome, NewEntityRecord, WriteOutcome,
};

/// Register `record`. Idempotent: `ON CONFLICT (id) DO NOTHING` (CS-02).
///
/// Owner columns are bound through the crate's single owner encoder. Both
/// already satisfy the `owner_id` CHECK by construction of [`crate::Owner`].
///
/// A no-op conflict still holds the conflicting row's lock until the
/// caller commits, as with `upsert_owner_grant`.
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

/// Set `deleted_at = at`. Last write wins, mirroring the resource row's own
/// `SET "deletedAt" = NOW()`, so the two never disagree after any call
/// sequence. Does not touch `updated_at` (neither does the resource).
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

/// Set `updated_at = at`, mirroring the resource's `updatedAt` so
/// owner-scoped listings can order by recency without joining resource tables.
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

/// Remove the row. Call beside `entity_access_db_utils::delete_entity_access_rows`
/// when the resource is hard-deleted.
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
