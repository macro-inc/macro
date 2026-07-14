//! Track when a chat was last accessed.

use sqlx::{Postgres, Transaction};

/// Record the last-accessed timestamp for this chat.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn upsert_item_last_accessed(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "ItemLastAccessed" ("item_id", "item_type", "last_accessed")
        VALUES ($1, 'chat', NOW())
        ON CONFLICT ("item_id", "item_type") DO UPDATE
        SET "last_accessed" = NOW()
        "#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
