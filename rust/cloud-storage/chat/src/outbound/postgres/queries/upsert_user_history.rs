//! Upsert a chat entry in the user's history.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Postgres, Transaction};

/// Record that the user accessed this chat in their history.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn upsert_user_history(
    tx: &mut Transaction<'_, Postgres>,
    user_id: MacroUserIdStr<'_>,
    chat_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        VALUES ($1, $2, 'chat', NOW(), NOW())
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW()
        "#,
        user_id.as_ref(),
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
