//! Query for project access level.

#[cfg(test)]
mod test;

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
                sp."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" sp
            WHERE sp."linkShare" = 'PUBLIC'
            AND sp."linkShareAccessLevel" IS NOT NULL
            AND sp.id IN (
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $1
            )

            "#,
            &project_id.to_string()
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
            AND entity_type = 'project'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: project link share permission
            SELECT
                sp."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" sp
            WHERE sp."linkShareAccessLevel" IS NOT NULL
            AND sp.id IN (
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $3
            )
            AND (
                sp."linkShare" = 'PUBLIC'
                OR (
                    sp."linkShare" = 'TEAM'
                    AND EXISTS (
                        SELECT 1
                        FROM "Project" p
                        JOIN team_user owner_team ON owner_team.user_id = p."userId"
                        WHERE p.id = $3
                        AND owner_team.team_id::text = ANY($2)
                    )
                )
            )
        ) AS combined_access
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
