//! Create a share permission and link it to a chat.

use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Postgres, Transaction};

/// Create a share permission row and associate it with the given chat.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn create_chat_permission(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<()> {
    let link_share = share_permission.link_share;
    let link_share_access_level = link_share.map(|_| {
        share_permission.link_share_access_level.unwrap_or_else(|| {
            tracing::warn!("link sharing was enabled without an access level, defaulting to view");
            AccessLevel::View
        })
    });
    let link_share = link_share.map(|value| value.to_string());

    let permission_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "SharePermission" (
            "linkShare",
            "linkShareAccessLevel",
            "createdAt",
            "updatedAt"
        )
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        link_share,
        link_share_access_level as _,
    )
    .fetch_one(tx.as_mut())
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "ChatPermission" ("chatId", "sharePermissionId")
        VALUES ($1, $2)
        "#,
        chat_id,
        permission_id,
    )
    .execute(tx.as_mut())
    .await
    .inspect_err(|e| tracing::error!(error=?e, "unable to create chat permission"))?;

    Ok(())
}
