//! Scheduled-action grants in `entity_access`.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;

/// Highest grant the viewer's sources hold on one scheduled action.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_scheduled_action_access(
    pool: &PgPool,
    id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        SELECT access_level AS "access_level!: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'scheduled_action' AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $3))
        "#,
        id,
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}

/// Live scheduled-action ids the user's sources can reach.
///
/// The join drops grants whose action row is gone.
#[tracing::instrument(err, skip(pool, user_id))]
pub(crate) async fn accessible_scheduled_action_ids(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT ea.entity_id
        FROM entity_access ea
        JOIN scheduled_action sa ON sa.id = ea.entity_id
        WHERE ea.entity_type = 'scheduled_action' AND ea.source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, NULL) s(source)))
        "#,
        user_id.as_ref(),
    )
    .fetch_all(pool)
    .await
}
