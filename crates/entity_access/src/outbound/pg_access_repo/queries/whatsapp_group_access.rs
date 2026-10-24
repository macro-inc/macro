//! Query for whatsapp_group access level.

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;

/// Highest access level the caller's `source_ids` reach on an whatsapp_group.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_whatsapp_group_access(
    pool: &PgPool,
    whatsapp_group_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        WITH entity_access_grants AS (
            SELECT ea.access_level
            FROM entity_access ea
            WHERE ea.entity_id = $1
              AND ea.entity_type = 'whatsapp_group'
              AND ea.source_id = ANY($2)
        ),
        link_share_grants AS (
            SELECT sp."linkShareAccessLevel" AS access_level
            FROM whatsapp_group i
            JOIN "SharePermission" sp ON sp.id = i.share_permission_id
            WHERE i.id = $1
              AND sp."linkShareAccessLevel" IS NOT NULL
              AND (
                  sp."linkShare" = 'PUBLIC'
                  OR (
                      sp."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM team_user owner_team
                          WHERE owner_team.user_id = i.user_id
                            AND owner_team.team_id::text = ANY($2)
                      )
                  )
              )
        )
        SELECT access_level AS "access_level!: AccessLevel"
        FROM (
            SELECT access_level FROM entity_access_grants
            UNION ALL
            SELECT access_level FROM link_share_grants
        ) AS grants
        "#,
        whatsapp_group_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}
