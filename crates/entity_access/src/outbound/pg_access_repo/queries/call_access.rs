//! Query for call access level.

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
use std::str::FromStr;

/// Get the highest access level a viewer has for a call.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_call_access(
    pool: &PgPool,
    call_id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if viewer.is_anonymous() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" share_permission
            JOIN (
                SELECT share_permission_id FROM call_entities WHERE id = $1
            ) call_item ON call_item.share_permission_id = share_permission.id
            WHERE share_permission."linkShare" = 'PUBLIC'
              AND share_permission."linkShareAccessLevel" IS NOT NULL
            "#,
            call_id,
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
            AND entity_type = 'call'
            AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $3))

            UNION ALL
            -- Source 2: call link share permission
            SELECT
                share_permission."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" share_permission
            JOIN (
                SELECT share_permission_id, user_id AS created_by FROM call_entities WHERE id = $1
            ) call_item ON call_item.share_permission_id = share_permission.id
            WHERE share_permission."linkShareAccessLevel" IS NOT NULL
              AND (
                  share_permission."linkShare" = 'PUBLIC'
                  OR (
                      share_permission."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM team_user owner_team
                          WHERE owner_team.user_id = call_item.created_by
                            AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, $3))
                      )
                  )
              )
        ) AS combined_access
        "#,
        call_id,
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, user_id))]
pub async fn explain_call_access(
    pool: &PgPool,
    call_id: &uuid::Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants = list_entity_access_grants(pool, call_id, EntityType::Call, user_id).await?;

    let public_levels = sqlx::query_scalar!(
        r#"
        SELECT
            share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel"
        FROM "SharePermission" share_permission
        JOIN (
            SELECT share_permission_id FROM call_entities WHERE id = $1
        ) call_item ON call_item.share_permission_id = share_permission.id
        WHERE share_permission."linkShare" = 'PUBLIC'
          AND share_permission."linkShareAccessLevel" IS NOT NULL
        "#,
        call_id,
    )
    .fetch_all(pool)
    .await?;
    grants.extend(
        public_levels
            .into_iter()
            .map(|access_level| AccessGrant::PublicLink { access_level }),
    );

    let team_rows = sqlx::query!(
        r#"
        SELECT
            share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel",
            owner_team.team_id AS "owner_team_id!"
        FROM "SharePermission" share_permission
        JOIN (
            SELECT share_permission_id, user_id AS created_by FROM call_entities WHERE id = $1
        ) call_item ON call_item.share_permission_id = share_permission.id
        JOIN team_user owner_team
          ON owner_team.user_id = call_item.created_by
         AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, NULL))
        WHERE share_permission."linkShare" = 'TEAM'
          AND share_permission."linkShareAccessLevel" IS NOT NULL
        "#,
        call_id,
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
