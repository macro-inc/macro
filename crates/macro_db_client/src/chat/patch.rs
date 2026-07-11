use sqlx::{Postgres, Transaction};

pub async fn update_chat_token_count(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    token_count: i64,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "tokenCount" = $1
        WHERE id = $2
        "#,
        token_count,
        chat_id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
