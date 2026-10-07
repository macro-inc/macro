//! Grants keyed by their source, across every entity.

use crate::EntityAccessSourceType;
use sqlx::{Executor, Postgres};

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
#[tracing::instrument(skip(executor), err)]
pub async fn delete_source_grants<'e, E>(
    executor: E,
    source_type: EntityAccessSourceType,
    source_id: &str,
) -> Result<u64, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        "DELETE FROM entity_access WHERE source_type = $1 AND source_id = $2",
        source_type as _,
        source_id,
    )
    .execute(executor)
    .await?;
    Ok(result.rows_affected())
}
