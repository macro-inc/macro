//! Query for an external chat's access level.

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;

/// Highest access level the caller's `source_ids` reach on an external chat,
/// from the database's one implementation of the rule
/// (`external_chat_access_level`, also behind `external_chat_can_view` and
/// the attachment branch of `document_access`).
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_external_chat_access(
    pool: &PgPool,
    chat_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT external_chat_access_level($1, $2) AS "access_level?: AccessLevel""#,
        chat_id,
        &source_ids.0,
    )
    .fetch_one(pool)
    .await
}
