//! Dashboard grants: the owner, the owners and admins of the owner's teams,
//! and the caller's direct, team and channel grants.

#[cfg(test)]
mod test;

use super::SourceIds;
use crate::domain::models::AccessLevel;
use sqlx::PgPool;
use uuid::Uuid;

/// Resolve one dashboard's access for `user_id`, whose grant sources are
/// `sources`. `None` when the dashboard is gone or the caller has no access.
pub async fn get_dashboard_access(
    pool: &PgPool,
    id: Uuid,
    user_id: &str,
    sources: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let level = sqlx::query_scalar!(
        r#"
        SELECT CASE
            WHEN d.user_id = $2 THEN 'owner'::"AccessLevel"
            ELSE GREATEST(
                (
                    SELECT max(ea.access_level)
                    FROM entity_access ea
                    WHERE ea.entity_id = d.id
                      AND ea.entity_type = 'dashboard'
                      AND ea.source_id = ANY($3)
                ),
                CASE WHEN EXISTS (
                    SELECT 1
                    FROM team_user manager
                    JOIN team_user member ON member.team_id = manager.team_id
                    WHERE manager.user_id = $2
                      AND manager.team_role IN ('owner', 'admin')
                      AND member.user_id = d.user_id
                ) THEN 'edit'::"AccessLevel" END
            )
        END AS "access_level?: AccessLevel"
        FROM dashboard_entities d
        WHERE d.id = $1
        "#,
        id,
        user_id,
        &sources.0,
    )
    .fetch_optional(pool)
    .await?;

    Ok(level.flatten())
}
