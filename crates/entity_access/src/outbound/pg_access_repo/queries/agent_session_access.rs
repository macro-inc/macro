//! Query for agent session access level.

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for an agent session.
///
/// A session's grants are written when it is created: the owner with
/// owner, and - when the session was opened by a mention - the channel that
/// mention was posted in as editor. Channel membership is not copied into
/// `entity_access`; it arrives here through `source_ids`, so adding someone
/// to that channel gives them the session on their next request.
///
/// Unlike documents and calls there is no public-sharing arm: a session
/// carries no `SharePermission`, so a caller with no source ids has no way
/// to reach one.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_agent_session_access(
    pool: &PgPool,
    agent_session_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
        AND entity_type = 'agent_session'
        AND source_id = ANY($2)
        "#,
        agent_session_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}
