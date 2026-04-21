//! Query for chat access level.

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
                "publicAccessLevel" as "access_level!"
            FROM "SharePermission"
            WHERE "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = $1
            )

            "#,
            &chat_id.to_string()
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
            AND entity_type = 'chat'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: items share permission
            SELECT
                "publicAccessLevel" as "access_level!"
            FROM "SharePermission"
            WHERE "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = $3
            )
        )
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
