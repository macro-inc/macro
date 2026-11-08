//! Fetch a user's access level on a chat.

use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Get the user's access level on a chat from the `entity_access` table.
///
/// Checks access via all of the user's source IDs (direct user ID, team
/// memberships, and channel participations) and returns the highest level found.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_access_level(
    pool: &sqlx::PgPool,
    user_id: &str,
    chat_id: &str,
) -> anyhow::Result<AccessLevel> {
    let entity_id = macro_uuid::string_to_uuid(chat_id).unwrap();
    let level = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE source_id = ANY(ARRAY(
            SELECT cp.channel_id::text FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ))
        AND entity_id = $2
        AND entity_type = 'chat'
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
        entity_id,
    )
    .fetch_optional(pool)
    .await?
    .flatten()
    .unwrap_or_default();

    Ok(AccessLevel::from_str(&level).unwrap_or(AccessLevel::View))
}
