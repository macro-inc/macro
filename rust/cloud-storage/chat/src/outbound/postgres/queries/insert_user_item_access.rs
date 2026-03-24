//! Grant a user access to a chat.

use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Postgres, Transaction};

/// Insert an access record granting the user the given access level on a chat.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn insert_user_item_access(
    tx: &mut Transaction<'_, Postgres>,
    user_id: MacroUserIdStr<'_>,
    chat_id: &str,
    access_level: AccessLevel,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();

    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess" (
            "id",
            "user_id",
            "item_id",
            "item_type",
            "access_level",
            "created_at",
            "updated_at"
        )
        VALUES ($1, $2, $3, 'chat', $4, NOW(), NOW())
        "#,
        id,
        user_id.as_ref(),
        chat_id,
        access_level as _,
    )
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
