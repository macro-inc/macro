//! Query for project access level.

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for a project.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_project_access(
    pool: &PgPool,
    project_id: &uuid::Uuid,
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
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $1
            )

            "#,
            &project_id.to_string()
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
            AND entity_type = 'project'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: items share permission
            SELECT
                "publicAccessLevel" as "access_level!"
            FROM "SharePermission"
            WHERE "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $3
            )
        )
        "#,
        project_id,
        &source_ids.0,
        &project_id.to_string()
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}
