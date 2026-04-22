//! Query for email thread access level.

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

/// Get the highest access level a user has for an email thread.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_thread_access(
    pool: &PgPool,
    thread_id: &Uuid,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let user_id_str = user_id.map(AsRef::as_ref).unwrap_or("");

    // Thread-specific: check if user is the thread owner via email_links
    let is_owner = sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1
                FROM public.email_threads t
                JOIN public.email_links l ON l.id = t.link_id
                WHERE t.id = $1::uuid
                  AND l.macro_id = $2
            ) AS "exists!"
            "#,
        thread_id,
        user_id_str
    )
    .fetch_one(pool)
    .await?;

    if is_owner {
        return Ok(Some(AccessLevel::Owner));
    }

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
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $1
            )

            "#,
            &thread_id.to_string()
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
            AND entity_type = 'email_thread'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: items share permission
            SELECT
                "publicAccessLevel"::text AS access_level
            FROM "SharePermission"
            WHERE "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $3
            )
        ) AS combined_access
        "#,
        thread_id,
        &source_ids.0,
        &thread_id.to_string()
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}
