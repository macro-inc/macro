use std::collections::HashSet;

use model::chat::preview::{ChatPreviewData, ChatPreviewV2, WithChatId};

#[tracing::instrument(skip(db))]
pub async fn batch_get_document_preview_v2(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_ids: &[String],
) -> anyhow::Result<Vec<ChatPreviewV2>> {
    let found_chats: Vec<ChatPreviewData> = sqlx::query_as!(
        ChatPreviewData,
        r#"
            SELECT
                c.id as chat_id,
                c.name as chat_name,
                c."userId" as owner,
                c."updatedAt"::timestamptz as "updated_at"
            FROM
                "Chat" c
            WHERE
                c."id" = ANY($1)
        "#,
        chat_ids,
    )
    .fetch_all(db)
    .await?;

    let found: HashSet<String> = found_chats.iter().map(|row| row.chat_id.clone()).collect();

    let result: Vec<ChatPreviewV2> = chat_ids
        .iter()
        .map(|id| {
            if !found.contains(id) {
                ChatPreviewV2::DoesNotExist(WithChatId {
                    chat_id: id.clone(),
                })
            } else {
                let row = found_chats.iter().find(|r| r.chat_id == *id).unwrap();

                ChatPreviewV2::Found(row.clone())
            }
        })
        .collect();

    Ok(result)
}
