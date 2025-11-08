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
