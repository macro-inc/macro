//! Fetch share permissions for a chat.

use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use std::str::FromStr;

/// Get the [`SharePermissionV2`] for a chat.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_chat_share_permission(
    pool: &sqlx::PgPool,
    chat_id: &str,
) -> anyhow::Result<SharePermissionV2> {
    let result = sqlx::query!(
        r#"
        SELECT
            sp.id as id,
            sp."isPublic" as is_public,
            sp."publicAccessLevel" as "public_access_level?",
            c."userId" as owner,
            COALESCE(
                json_agg(json_build_object(
                    'channel_id', csp."channel_id",
                    'access_level', csp."access_level"
                )) FILTER (WHERE csp."channel_id" IS NOT NULL),
                '[]'
            ) as "channel_share_permissions?"
        FROM
            "ChatPermission" cp
        JOIN "SharePermission" sp ON cp."sharePermissionId" = sp.id
        JOIN "Chat" c ON cp."chatId" = c.id
        LEFT JOIN "ChannelSharePermission" csp ON csp."share_permission_id" = sp.id
        WHERE
            cp."chatId" = $1
        GROUP BY
            sp.id, c."userId"
        "#,
        chat_id,
    )
    .fetch_one(pool)
    .await?;

    let channel_share_permissions: Option<Vec<ChannelSharePermission>> =
        if let Some(channel_share_permissions) = result.channel_share_permissions {
            let parsed: Vec<ChannelSharePermission> =
                serde_json::from_value(channel_share_permissions)?;
            if parsed.is_empty() {
                None
            } else {
                Some(parsed)
            }
        } else {
            None
        };

    let public_access_level: Option<AccessLevel> = result
        .public_access_level
        .map(|s| AccessLevel::from_str(&s).unwrap());

    Ok(SharePermissionV2 {
        id: result.id,
        is_public: result.is_public,
        public_access_level,
        owner: result.owner,
        channel_share_permissions,
    })
}
