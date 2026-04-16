//! Fetch a user's access level on a chat.

use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Get the user's access level on a chat from the `UserItemAccess` table.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_access_level(
    pool: &sqlx::PgPool,
    user_id: &str,
    chat_id: &str,
) -> anyhow::Result<AccessLevel> {
    let level = sqlx::query_scalar!(
        r#"
        SELECT "access_level"::text
        FROM "UserItemAccess"
        WHERE "user_id" = $1 AND "item_id" = $2 AND "item_type" = 'chat'
        "#,
        user_id,
        chat_id,
    )
    .fetch_one(pool)
    .await?
    .unwrap_or_default();

    Ok(AccessLevel::from_str(&level).unwrap_or(AccessLevel::View))
}
