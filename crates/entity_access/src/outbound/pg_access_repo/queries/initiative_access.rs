//! Query for initiative access level.

#[cfg(test)]
mod test;

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
#[cfg(feature = "explain_binary")]
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;

/// Highest access level the viewer reaches on an initiative.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        WITH entity_access_grants AS (
            SELECT ea.access_level
            FROM entity_access ea
            WHERE ea.entity_id = $1
              AND ea.entity_type = 'initiative'
              AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $2, $3))
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
                            AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, $3))
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
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}

/// Every grant path behind [`get_initiative_access`], labeled.
#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, user_id))]
pub async fn explain_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants =
        list_entity_access_grants(pool, initiative_id, EntityType::Initiative, user_id).await?;

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
         AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, NULL))
        WHERE i.id = $1
          AND sp."linkShare" = 'TEAM'
          AND sp."linkShareAccessLevel" IS NOT NULL
        "#,
        initiative_id,
        user_id.as_ref(),
    )
    .fetch_all(pool)
    .await?;
    grants.extend(team_rows.into_iter().map(|row| AccessGrant::TeamLink {
        access_level: row.access_level,
        owner_team_id: row.owner_team_id,
    }));

    Ok(grants)
}
