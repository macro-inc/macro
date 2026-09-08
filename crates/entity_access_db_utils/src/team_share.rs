//! Low-level direct team grants for the canonical team-share writer.
//!
//! Connection helpers require the caller to hold [`acquire_guard`] in its existing
//! transaction. They do not infer consent, authorize users, or commit transactions.
//! Use `share_permission_db_utils::team_share` for canonical mutations.

use crate::{AccessLevel, EntityType};
use macro_uuid::Uuid;
use sqlx::{PgConnection, Postgres, Transaction};

#[cfg(test)]
mod test;

/// Acquire the database-wide TEAM/version-1 transaction guard before any row locks
/// or mutations affecting team sharing, membership, ownership, or project topology.
///
/// Participants must use READ COMMITTED so reads after waiting see the previous
/// holder's committed facts. The guard is held until the caller commits/rolls back.
pub async fn acquire_guard(transaction: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    let isolation = sqlx::query_scalar!("SELECT current_setting('transaction_isolation')")
        .fetch_one(transaction.as_mut())
        .await?;
    if isolation.as_deref() != Some("read committed") {
        return Err(sqlx::Error::InvalidArgument(
            "team-share guard requires READ COMMITTED isolation".into(),
        ));
    }
    sqlx::query!("SELECT pg_advisory_xact_lock(1413824845, 1)")
        .execute(transaction.as_mut())
        .await?;
    Ok(())
}

/// Ensure the authoritative owner's direct grant during lazy permission creation.
/// Returns false without changing a conflicting non-owner grant. The caller must
/// hold the guard and must not create a permission association on that conflict.
pub async fn ensure_owner_direct(
    connection: &mut PgConnection,
    entity_id: &Uuid,
    entity_type: EntityType,
    owner: &macro_user_id::user_id::MacroUserIdStr<'_>,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, $2, $3, 'user', 'owner')
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        DO UPDATE SET access_level = EXCLUDED.access_level
        WHERE entity_access.access_level = 'owner'
        RETURNING id"#,
        entity_id,
        entity_type.as_ref(),
        owner.as_ref(),
    )
    .fetch_optional(connection)
    .await?;
    Ok(row.is_some())
}

/// Read only a team's direct grant; inherited contributions do not count.
pub async fn direct_level(
    connection: &mut PgConnection,
    entity_id: &Uuid,
    entity_type: EntityType,
    team_id: Uuid,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'team'
          AND source_id = $3 AND granted_from_project_id IS NULL"#,
        entity_id,
        entity_type.as_ref(),
        team_id.to_string(),
    )
    .fetch_optional(connection)
    .await
}

/// Set an already validated managed direct grant to the exact level, including downgrades.
/// The canonical caller must reject untracked conflicts before invoking this helper.
pub async fn upsert_direct(
    connection: &mut PgConnection,
    entity_id: &Uuid,
    entity_type: EntityType,
    team_id: Uuid,
    level: AccessLevel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, $2, $3, 'team', $4)
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()"#,
        entity_id,
        entity_type.as_ref(),
        team_id.to_string(),
        level as _,
    )
    .execute(connection)
    .await?;
    Ok(())
}

/// Delete only the recorded managed team's direct grant, independent of membership.
pub async fn delete_direct(
    connection: &mut PgConnection,
    entity_id: &Uuid,
    entity_type: EntityType,
    managed_team_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'team'
          AND source_id = $3 AND granted_from_project_id IS NULL"#,
        entity_id,
        entity_type.as_ref(),
        managed_team_id.to_string(),
    )
    .execute(connection)
    .await?;
    Ok(())
}
