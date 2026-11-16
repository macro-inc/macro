//! The teams that hold access to an entity themselves, not through one of
//! their members.

#[cfg(test)]
mod test;

use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::AccessLevel;

/// Teams granted an entity: a `team` grant, or a grant to a channel the team
/// owns (a team channel), each at `min_level` or above when given. Grants
/// inherited from a project are rows on the entity too, so they count. A
/// member's own grants, channels the team does not own and link shares never
/// do. The entity's grants are read once (`entity_access` by entity id and
/// type) and only then joined to their channels by primary key, so the cost
/// follows the entity's grants, never the number of team channels.
#[tracing::instrument(err, skip(pool))]
pub async fn granted_teams(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
    min_level: Option<AccessLevel>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let teams = sqlx::query_scalar!(
        r#"
        WITH grants AS MATERIALIZED (
            SELECT ea.source_type, ea.source_id::uuid AS source_id FROM entity_access ea
            WHERE ea.entity_id = $1 AND ea.entity_type = $2
              AND ea.source_type IN ('team', 'channel')
              AND ($3::text IS NULL OR ea.access_level >= $3::text::"AccessLevel")
        )
        SELECT team_id AS "team_id!" FROM (
            SELECT g.source_id AS team_id FROM grants g WHERE g.source_type = 'team'

            UNION

            SELECT c.team_id FROM grants g
            JOIN comms_channels c ON c.id = g.source_id
            WHERE g.source_type = 'channel' AND c.team_id IS NOT NULL
        ) AS granted
        ORDER BY team_id
        "#,
        entity_id,
        entity_type.as_ref(),
        min_level.map(|level| level.to_string()),
    )
    .fetch_all(pool)
    .await?;
    Ok(teams)
}

/// The team that owns a team channel; none for other channels.
#[tracing::instrument(err, skip(pool))]
pub async fn channel_team(pool: &PgPool, channel_id: &Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    let team = sqlx::query_scalar!(
        r#"SELECT team_id FROM comms_channels WHERE id = $1"#,
        channel_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(team.flatten())
}

/// The team that owns a CRM company or contact while every member may see it:
/// a hidden record (or a contact of a hidden company) is for admins only, so
/// it has no team-wide access.
#[tracing::instrument(err, skip(pool))]
pub async fn crm_team(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
) -> Result<Option<Uuid>, sqlx::Error> {
    match entity_type {
        EntityType::CrmCompany => {
            sqlx::query_scalar!(
                r#"SELECT team_id FROM crm_companies WHERE id = $1 AND NOT hidden"#,
                entity_id,
            )
            .fetch_optional(pool)
            .await
        }
        EntityType::CrmContact => {
            sqlx::query_scalar!(
                r#"
                SELECT ct.team_id FROM crm_contacts ct
                LEFT JOIN crm_companies c ON c.id = ct.company_id
                WHERE ct.id = $1 AND NOT (ct.hidden OR c.hidden IS TRUE)
                "#,
                entity_id,
            )
            .fetch_optional(pool)
            .await
        }
        _ => Ok(None),
    }
}
