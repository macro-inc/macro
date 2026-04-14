//! Query for call access level.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for a call.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_call_access(
    pool: &PgPool,
    call_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
            "publicAccessLevel" as "access_level!"
            FROM "SharePermission"
            WHERE id in (SELECT share_permission_id
            FROM calls
            WHERE id = $1
            UNION ALL
            SELECT share_permission_id
            FROM call_records
            WHERE id = $1
            LIMIT 1)
            AND "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            "#,
            &call_id
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level.and_then(|level| AccessLevel::from_str(&level).ok()));
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'call'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: items share permission
            SELECT
                "publicAccessLevel" as "access_level!"
            FROM "SharePermission"
            WHERE id in (
                SELECT share_permission_id
                FROM calls
                WHERE id = $1
                UNION ALL
                SELECT share_permission_id
                FROM call_records
                WHERE id = $1
                LIMIT 1
            )
            AND "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
        )
        "#,
        call_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}
