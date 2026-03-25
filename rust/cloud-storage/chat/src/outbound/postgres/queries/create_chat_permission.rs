//! Create a share permission and link it to a chat.

use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Postgres, Transaction};

/// Create a share permission row and associate it with the given chat.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn create_chat_permission(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<()> {
    let permission_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "SharePermission" ("isPublic", "publicAccessLevel", "createdAt", "updatedAt")
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        share_permission.is_public,
        share_permission
            .public_access_level
            .as_ref()
            .map(|s| s.to_string()),
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
