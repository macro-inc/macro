//! Low-level direct team grants for the canonical team-share writer.
//!
//! Connection helpers require the caller to hold [`acquire_guard`] in its existing
//! transaction. They do not infer consent, authorize users, or commit transactions.
//! Use `share_permission_db_utils::team_share` for canonical mutations.

use crate::{AccessLevel, EntityAccessSourceType, EntityType, get_nested_project_entities};
use macro_uuid::Uuid;
use sqlx::{PgConnection, Postgres, QueryBuilder, Transaction};

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

/// Bind parameters per nested `entity_access` row in the inherited-grant upsert.
const NESTED_TEAM_GRANT_BINDS_PER_ROW: usize = 6;
/// Nested rows per INSERT. Six binds each; stay under Postgres' 65535-parameter limit.
const NESTED_TEAM_GRANT_CHUNK_SIZE: usize = 8_192;
const _: () = assert!(NESTED_TEAM_GRANT_CHUNK_SIZE * NESTED_TEAM_GRANT_BINDS_PER_ROW < 65_535);

/// Copy or remove this project's managed team grant on nested contents.
///
/// Document and chat access reads `entity_access` on the child, not the folder.
/// Person and channel folder sharing already write `granted_from_project_id` rows.
/// Same-team refreshes delete then rebuild so inherited rows whose entities left
/// the tree cannot linger.
pub async fn replace_project_contributions(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &Uuid,
    previous_team_id: Option<Uuid>,
    target: Option<(Uuid, AccessLevel)>,
) -> Result<(), sqlx::Error> {
    let project_id_str = project_id.to_string();
    if let Some(previous_team_id) = previous_team_id {
        sqlx::query!(
            r#"DELETE FROM entity_access
            WHERE granted_from_project_id = $1
              AND source_type = 'team'
              AND source_id = $2"#,
            project_id_str,
            previous_team_id.to_string(),
        )
        .execute(transaction.as_mut())
        .await?;
    }
    let Some((team_id, level)) = target else {
        return Ok(());
    };
    let rows: Vec<_> = get_nested_project_entities(transaction, project_id)
        .await?
        .into_iter()
        .filter(|entity| !(entity.entity_type == "project" && entity.entity_id == project_id_str))
        .filter_map(|entity| {
            macro_uuid::string_to_uuid(&entity.entity_id)
                .ok()
                .map(|id| (id, entity.entity_type))
        })
        .collect();
    if rows.is_empty() {
        return Ok(());
    }
    let team_id_str = team_id.to_string();
    for chunk in rows.chunks(NESTED_TEAM_GRANT_CHUNK_SIZE) {
        let mut query = QueryBuilder::new(
            "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
        );
        query.push_values(chunk, |mut row, (nested_id, nested_type)| {
            row.push_bind(*nested_id)
                .push_bind(nested_type)
                .push_bind(team_id_str.clone())
                .push_bind(EntityAccessSourceType::Team)
                .push_bind(level)
                .push_bind(project_id_str.clone());
        });
        query.push(
            " ON CONFLICT (entity_id, entity_type, source_id, source_type, granted_from_project_id) \
              WHERE granted_from_project_id IS NOT NULL \
              DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()",
        );
        query.build().execute(transaction.as_mut()).await?;
    }
    Ok(())
}
