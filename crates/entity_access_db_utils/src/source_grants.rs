//! Grants keyed by their source, across every entity.

use crate::EntityAccessSourceType;
use sqlx::{Postgres, Transaction};

#[cfg(test)]
mod test;

/// Delete every grant whose source is `source_type` and `source_id`, on every
/// entity of every type, project-inherited grants included. Returns how many
/// rows were deleted.
///
/// For removing a principal. Does not authorize and does not commit. Deleting a
/// team source is a team-sharing mutation, so hold
/// [`acquire_guard`](crate::team_share::acquire_guard) in the same transaction
/// first.
#[tracing::instrument(skip(transaction), err)]
pub async fn delete_source_grants(
    transaction: &mut Transaction<'_, Postgres>,
    source_type: EntityAccessSourceType,
    source_id: &str,
) -> Result<u64, sqlx::Error> {
    let rows = sqlx::query!(
        "DELETE FROM entity_access WHERE source_type = $1 AND source_id = $2 RETURNING entity_type, entity_id::text AS \"entity_id!\"",
        source_type as _,
        source_id,
    )
    .map(|row| (row.entity_type, row.entity_id))
    .fetch_all(transaction.as_mut())
    .await?;
    source_items::sync_rows(transaction.as_mut(), &rows).await?;
    Ok(rows.len() as u64)
}
