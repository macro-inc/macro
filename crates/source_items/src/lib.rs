#![deny(missing_docs)]
//! Transactional application maintenance for the rebuildable source-item projection.

use model_entity::EntityType;
use sqlx::{Connection, PgConnection};
use std::collections::BTreeSet;

pub mod backfill;
pub mod project_deletion;

#[cfg(test)]
mod test;

/// Refresh one item's projection after its authoritative mutation.
///
/// The connection must be inside the caller's transaction. Never pass an
/// autocommit connection: the mutation, lock, and refresh must commit together.
pub async fn sync_one(
    connection: &mut PgConnection,
    entity_type: EntityType,
    entity_id: &str,
) -> Result<(), sqlx::Error> {
    sync_many(connection, entity_type, &[entity_id.to_owned()]).await
}

/// The most advisory locks one transaction takes for refreshes. Advisory locks
/// occupy PostgreSQL's shared lock table until commit, so a refresh that would
/// pass this total, such as one for a team's or a project tree's items, relies
/// on row locks alone.
const ADVISORY_LOCK_LIMIT: i32 = 1_000;

/// Rebuild the named items from their current grants and item state.
///
/// Call after all authoritative writes, inside the same READ COMMITTED
/// transaction. The refresh locks each visible item's row, which serializes it
/// with other refreshes and with writers that update the item. Row locks live
/// in the rows, so a refresh of any size holds them without filling the lock
/// table. While the transaction holds at most [`ADVISORY_LOCK_LIMIT`] of them,
/// a refresh also takes per-id advisory locks, which serialize a grant written
/// for an item whose insert has not committed yet. The refresh is a separate statement so it sees the
/// previous lock holder's committed canonical writes. Other entity types have
/// no rows in this projection.
pub async fn sync_many(
    connection: &mut PgConnection,
    entity_type: EntityType,
    entity_ids: &[String],
) -> Result<(), sqlx::Error> {
    if entity_ids.is_empty()
        || !matches!(
            entity_type,
            EntityType::Document | EntityType::Chat | EntityType::Project
        )
    {
        return Ok(());
    }
    if !connection.is_in_transaction() {
        return Err(sqlx::Error::InvalidArgument(
            "source-item maintenance requires the authoritative write transaction".into(),
        ));
    }
    let isolation = sqlx::query_file_scalar!(
        "src/lock.sql",
        entity_type.as_ref(),
        entity_ids,
        ADVISORY_LOCK_LIMIT,
    )
    .fetch_one(&mut *connection)
    .await?;
    if isolation != "read committed" {
        return Err(sqlx::Error::InvalidArgument(
            "source-item maintenance requires READ COMMITTED isolation".into(),
        ));
    }
    sqlx::query_file!("src/sync.sql", entity_type.as_ref(), entity_ids,)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// Refresh database-returned `(entity_type, entity_id)` keys after a bulk grant
/// mutation. Types outside the projection are ignored; each supported group is
/// refreshed once, in a fixed order, in the caller's existing transaction.
pub async fn sync_rows(
    connection: &mut PgConnection,
    items: &[(String, String)],
) -> Result<(), sqlx::Error> {
    for entity_type in [EntityType::Chat, EntityType::Document, EntityType::Project] {
        let ids = items
            .iter()
            .filter(|(kind, _)| kind == entity_type.as_ref())
            .map(|(_, id)| id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        sync_many(connection, entity_type, &ids).await?;
    }
    Ok(())
}
