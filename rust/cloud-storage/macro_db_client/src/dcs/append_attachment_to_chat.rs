use model::{StringID, chat::NewChatAttachment};
use sqlx::{Postgres, Transaction};

#[tracing::instrument(skip(transaction))]
async fn add_attachment(
    transaction: &mut Transaction<'_, Postgres>,
    new_attachment: NewChatAttachment,
) -> anyhow::Result<String> {
    let attachment = sqlx::query_as!(
        StringID,
        r#"
            INSERT INTO "ChatAttachment" ("attachmentType", "attachmentId", "chatId")
            VALUES ($1, $2, $3)
            RETURNING id;
        "#,
        new_attachment.attachment_type.to_string(),
        new_attachment.attachment_id,
        new_attachment.chat_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(attachment.id)
}

#[tracing::instrument(skip(transaction))]
pub async fn append_attachment_to_chat(
    transaction: &mut Transaction<'_, Postgres>,
    attachment: NewChatAttachment,
) -> anyhow::Result<()> {
    // Update chat updatedAt
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "updatedAt" = NOW()
        WHERE id = $1
        "#,
        attachment.chat_id,
    )
    .execute(&mut **transaction)
    .await?;

    add_attachment(transaction, attachment).await?;
    Ok(())
}
