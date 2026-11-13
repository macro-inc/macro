//! Query for an external chat's access level.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
use sqlx::PgPool;

/// Highest access level the viewer reaches on an external chat, from the
/// database's one implementation of the rule (`external_chat_access_level`,
/// also behind `external_chat_can_view`).
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_external_chat_access(
    pool: &PgPool,
    chat_id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT external_chat_access_level($1, $2, $3) AS "access_level?: AccessLevel""#,
        chat_id,
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_one(pool)
    .await
}
