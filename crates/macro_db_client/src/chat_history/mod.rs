use anyhow::Error;
use chrono::{DateTime, Utc};
use model::chat::{ChatHistory, ConversationRecord, MessageWithAttachments};
use sqlx::{Executor, FromRow, Postgres};
use std::collections::HashMap;

#[derive(FromRow)]
struct ChatHistoryRow {
    chat_id: String,
    chat_title: Option<String>,
    message_content: String,
    message_created_at: DateTime<Utc>,
    attachment_id: Option<String>,
}

/// Get chat history for a single chat by ID
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn get_chat_history<'e, E>(db: E, chat_id: &str) -> Result<ChatHistory, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let rows = sqlx::query_as::<_, ChatHistoryRow>(
        r#"
        SELECT
            c.id as chat_id,
            c.title as chat_title,
            m.content as message_content,
            m."createdAt" as message_created_at,
            ma."attachmentId" as attachment_id
        FROM "Chat" c
        JOIN "ChatMessage" m ON m."chatId" = c.id
        LEFT JOIN "ChatMessageAttachment" ma ON ma."messageId" = m.id
        WHERE c.id = $1
        ORDER BY m."createdAt" ASC
        "#,
    )
    .bind(chat_id)
    .fetch_all(db)
    .await?;

    Ok(build_chat_history(rows))
}

/// Get chat history for messages by their IDs
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn get_chat_history_for_messages<'e, E>(
    db: E,
    message_ids: &[String],
) -> Result<ChatHistory, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let rows = sqlx::query_as::<_, ChatHistoryRow>(
        r#"
        SELECT
            c.id as chat_id,
            c.title as chat_title,
            m.content as message_content,
            m."createdAt" as message_created_at,
            ma."attachmentId" as attachment_id
        FROM "Chat" c
        JOIN "ChatMessage" m ON m."chatId" = c.id
        LEFT JOIN "ChatMessageAttachment" ma ON ma."messageId" = m.id
        WHERE m.id = ANY($1)
        ORDER BY m."createdAt" ASC
        "#,
    )
    .bind(message_ids)
    .fetch_all(db)
    .await?;

    Ok(build_chat_history(rows))
}

fn build_chat_history(rows: Vec<ChatHistoryRow>) -> ChatHistory {
    type Chats = HashMap<String, (String, Vec<(String, DateTime<Utc>, Vec<String>)>)>;
    let mut chats: Chats = HashMap::new();

    for row in rows {
        let chat_entry = chats
            .entry(row.chat_id.clone())
            .or_insert_with(|| (row.chat_title.unwrap_or_default(), Vec::new()));

        // Find or create message entry
        let message_key = (row.message_content.clone(), row.message_created_at);
        let message_idx = chat_entry
            .1
            .iter()
            .position(|(content, date, _)| *content == message_key.0 && *date == message_key.1);

        match message_idx {
            Some(idx) => {
                if let Some(att_id) = row.attachment_id {
                    chat_entry.1[idx].2.push(att_id);
                }
            }
            None => {
                let attachments = row.attachment_id.into_iter().collect();
                chat_entry
                    .1
                    .push((row.message_content, row.message_created_at, attachments));
            }
        }
    }

    let conversation: Vec<ConversationRecord> = chats
        .into_iter()
        .map(|(chat_id, (title, messages))| {
            let messages = messages
                .into_iter()
                .map(|(content, date, attachment_ids)| MessageWithAttachments {
                    content,
                    date,
                    attachment_ids,
                })
                .collect();

            ConversationRecord {
                chat_id,
                title,
                messages,
            }
        })
        .collect();

    ChatHistory { conversation }
}
