use anyhow::{self, Result};
use model::chat::{AttachmentType, ChatAttachment};
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_attachments_for_message(
    db: Pool<Postgres>,
    message_id: &str,
) -> Result<Vec<ChatAttachment>> {
    let mut transaction = db.begin().await?;
    let attachments = sqlx::query_as!(
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
                ca."messageId" = $1
            LIMIT 1
        "#,
        message_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    if let Err(e) = transaction.commit().await {
        tracing::error!(error=?e, "get_attachments_for_message transaction error");
        Err(anyhow::anyhow!("transaction error"))
    } else {
        Ok(attachments)
    }
}
