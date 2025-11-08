use anyhow::Result;
use model::chat::{AttachmentType, ChatAttachment};
use sqlx::{Postgres, Transaction};

#[tracing::instrument(skip(transaction))]
pub async fn get_attachment(
    transaction: &mut Transaction<'_, Postgres>,
    id: &str,
) -> Result<ChatAttachment> {
    let attachment = sqlx::query_as!(
        ChatAttachment,
        r#"
            SELECT
                ca.id,
                ca."attachmentType" as "attachment_type: AttachmentType",
                ca."attachmentId" as "attachment_id",
                ca."chatId" as "chat_id",
                ca."messageId" as "message_id"
            FROM
                "ChatAttachment" ca
            WHERE
                ca."id" = $1
            LIMIT 1
        "#,
        id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(attachment)
}
