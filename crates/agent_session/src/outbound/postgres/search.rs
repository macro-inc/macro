//! Bounded-to-allowlist metadata lookup for search.

use crate::domain::search::AgentSessionSearchMetadata;

/// Fetch current metadata for already authorized session IDs.
#[tracing::instrument(err, skip(pool, ids))]
pub async fn search_metadata(
    pool: &sqlx::PgPool,
    ids: &[uuid::Uuid],
) -> Result<Vec<AgentSessionSearchMetadata>, sqlx::Error> {
    sqlx::query!(
        r#"
        SELECT id, name, owner_id, bot_id, created_at, modified_at
        FROM agent_session
        WHERE id = ANY($1)
        "#,
        ids,
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        Ok(AgentSessionSearchMetadata {
            id: row.id,
            name: row.name,
            owner_id: macro_user_id::user_id::MacroUserIdStr::try_from(row.owner_id)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            bot_id: row.bot_id,
            created_at: row.created_at,
            updated_at: row.modified_at,
        })
    })
    .collect()
}
