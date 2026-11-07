//! Query for initiative access level.

#[cfg(test)]
mod test;

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;

/// Highest access level the caller's `source_ids` reach on an initiative.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        WITH entity_access_grants AS (
            SELECT ea.access_level
            FROM entity_access ea
            WHERE ea.entity_id = $1
              AND ea.entity_type = 'initiative'
              AND ea.source_id = ANY($2)
        ),
        link_share_grants AS (
            SELECT sp."linkShareAccessLevel" AS access_level
            FROM initiative i
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
                          WHERE owner_team.user_id = i.owner_user_id
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
        initiative_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}

/// Every grant path behind [`get_initiative_access`], labeled.
#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn explain_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants =
        list_entity_access_grants(pool, initiative_id, EntityType::Initiative, source_ids).await?;

    let public_level: Option<AccessLevel> = sqlx::query_scalar!(
        r#"
        SELECT sp."linkShareAccessLevel" AS "access_level!: AccessLevel"
        FROM initiative i
        JOIN "SharePermission" sp ON sp.id = i.share_permission_id
        WHERE i.id = $1
          AND sp."linkShare" = 'PUBLIC'
          AND sp."linkShareAccessLevel" IS NOT NULL
        "#,
        initiative_id,
    )
    .fetch_optional(pool)
    .await?;
    grants.extend(public_level.map(|access_level| AccessGrant::PublicLink { access_level }));

    let team_rows = sqlx::query!(
        r#"
        SELECT
            sp."linkShareAccessLevel" AS "access_level!: AccessLevel",
            owner_team.team_id        AS "owner_team_id!"
        FROM initiative i
        JOIN "SharePermission" sp ON sp.id = i.share_permission_id
        JOIN team_user owner_team
          ON owner_team.user_id = i.owner_user_id
         AND owner_team.team_id::text = ANY($2)
        WHERE i.id = $1
          AND sp."linkShare" = 'TEAM'
          AND sp."linkShareAccessLevel" IS NOT NULL
        "#,
        initiative_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;
    grants.extend(team_rows.into_iter().map(|row| AccessGrant::TeamLink {
        access_level: row.access_level,
        owner_team_id: row.owner_team_id,
    }));

    Ok(grants)
}
