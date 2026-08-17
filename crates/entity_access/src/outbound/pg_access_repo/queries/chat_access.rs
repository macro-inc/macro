//! Query for chat access level.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for a chat.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_chat_access(
    pool: &PgPool,
    chat_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                sp."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" sp
            JOIN "ChatPermission" cp ON cp."sharePermissionId" = sp.id
            WHERE cp."chatId" = $1
              AND sp."linkShare" = 'PUBLIC'
              AND sp."linkShareAccessLevel" IS NOT NULL

            "#,
            &chat_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'chat'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: chat link share permission
            SELECT
                sp."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" sp
            JOIN "ChatPermission" cp ON cp."sharePermissionId" = sp.id
            WHERE cp."chatId" = $3
              AND sp."linkShareAccessLevel" IS NOT NULL
              AND (
                  sp."linkShare" = 'PUBLIC'
                  OR (
                      sp."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM "Chat" c
                          JOIN team_user owner_tu ON owner_tu.user_id = c."userId"
                          WHERE c.id = $3
                            AND owner_tu.team_id::text = ANY($2)
                      )
                  )
              )
        ) AS combined_access
        "#,
        chat_id,
        &source_ids.0,
        &chat_id.to_string()
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}
