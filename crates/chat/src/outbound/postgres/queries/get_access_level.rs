//! Fetch a user's access level on a chat.

#[cfg(test)]
mod test;

use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Get the user's access level on a chat from the `entity_access` table.
///
/// Checks the chat's grants against the user's sources (direct user ID, team
/// memberships, and channel participations) and returns the highest level found.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_access_level(
    pool: &sqlx::PgPool,
    user_id: &str,
    chat_id: &str,
) -> anyhow::Result<AccessLevel> {
    let entity_id = macro_uuid::string_to_uuid(chat_id).unwrap();
    let level = granted_level(pool, user_id, entity_id)
        .await?
        .unwrap_or_default();

    Ok(AccessLevel::from_str(&level).unwrap_or(AccessLevel::View))
}

/// The highest level the user's grants give on the chat, if any. Each grant's
/// source is matched against the user's memberships by index, so the cost
/// follows the chat's grants, not how many teams and channels the user is in.
async fn granted_level(
    pool: &sqlx::PgPool,
    user_id: &str,
    chat_id: uuid::Uuid,
) -> Result<Option<String>, sqlx::Error> {
    let level = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $2
        AND entity_type = 'chat'
        AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $1, NULL::uuid))
        ORDER BY
            CASE access_level::text
                WHEN 'owner' THEN 4
                WHEN 'edit' THEN 3
                WHEN 'comment' THEN 2
                WHEN 'view' THEN 1
                ELSE 0
            END DESC
        LIMIT 1
        "#,
        user_id,
        chat_id,
    )
    .fetch_optional(pool)
    .await?
    .flatten();

    Ok(level)
}
