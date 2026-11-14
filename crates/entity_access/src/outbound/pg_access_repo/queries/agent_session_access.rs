//! Query for agent session access level.

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::str::FromStr;

#[cfg(test)]
mod test;

/// List agent sessions granted to the user's current user/channel/team sources.
/// Optional requested IDs narrow the allowlist before it reaches OpenSearch.
#[tracing::instrument(err, skip(pool, user_id, requested_ids))]
pub async fn accessible_session_ids(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    requested_ids: &[uuid::Uuid],
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT entity_id
        FROM entity_access
        WHERE entity_type = 'agent_session'
          AND source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, NULL) s(source)))
          AND (cardinality($2::uuid[]) = 0 OR entity_id = ANY($2))
          -- Hidden sessions (thread-started, DM contexts) stay out of search
          -- unless asked for by id. A grant with no session row (tests, a deleted session) is
          -- not hidden: the predicate only matches a hidden row.
          AND (
              entity_id = ANY($2)
              OR NOT EXISTS (
                  SELECT 1 FROM agent_session s
                  WHERE s.id = entity_access.entity_id
                    AND s.visibility = 'hidden'
              )
          )
        "#,
        user_id.as_ref(),
        requested_ids,
    )
    .fetch_all(pool)
    .await
}

/// Get the highest access level a user has for an agent session.
///
/// A session's grants are written when it is created: the owner with
/// owner, and - when the session was opened by a mention - the channel that
/// mention was posted in, as editor, or as viewer when the bot is a user's
/// private agent. Channel membership is not copied into
/// `entity_access`; the grant matches the viewer's current channels, so adding
/// someone to that channel gives them the session on their next request.
///
/// Public links also work for an anonymous viewer. Team links require membership in
/// the owner's current team, while explicit team shares use canonical grants.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_agent_session_access(
    pool: &PgPool,
    agent_session_id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
        AND entity_type = 'agent_session'
        AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $3))

        UNION ALL

        SELECT sp."linkShareAccessLevel"::text
        FROM agent_session s
        JOIN "SharePermission" sp ON sp.id = s.share_permission_id
        WHERE s.id = $1
          AND sp."linkShareAccessLevel" IS NOT NULL
          AND (
              sp."linkShare" = 'PUBLIC'
              OR (
                  sp."linkShare" = 'TEAM'
                  AND EXISTS (
                      SELECT 1 FROM team_user owner_team
                      WHERE owner_team.user_id = s.owner_id
                        AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, $3))
                  )
              )
          )
        "#,
        agent_session_id,
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
pub async fn explain_agent_session_access(
    pool: &PgPool,
    agent_session_id: &uuid::Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants =
        list_entity_access_grants(pool, agent_session_id, EntityType::AgentSession, user_id)
            .await?;
    let links = sqlx::query!(
        r#"
        SELECT sp."linkShareAccessLevel" AS "access_level!: AccessLevel",
               sp."linkShare" = 'PUBLIC' AS "is_public!",
               owner_team.team_id AS "team_id?"
        FROM agent_session s
        JOIN "SharePermission" sp ON sp.id = s.share_permission_id
        LEFT JOIN team_user owner_team ON owner_team.user_id = s.owner_id
        WHERE s.id = $1
          AND sp."linkShareAccessLevel" IS NOT NULL
          AND (
              sp."linkShare" = 'PUBLIC'
              OR (sp."linkShare" = 'TEAM' AND EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, NULL)))
          )
        "#,
        agent_session_id,
        user_id.as_ref(),
    )
    .fetch_all(pool)
    .await?;
    grants.extend(links.into_iter().filter_map(|row| {
        if row.is_public {
            Some(AccessGrant::PublicLink {
                access_level: row.access_level,
            })
        } else {
            row.team_id.map(|owner_team_id| AccessGrant::TeamLink {
                access_level: row.access_level,
                owner_team_id,
            })
        }
    }));
    Ok(grants)
}
