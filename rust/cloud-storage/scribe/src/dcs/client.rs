use anyhow::Result;
use chat::domain::ports::ChatRepo;
use chat::outbound::postgres::PgChatRepo;
pub use model::chat::ChatHistory;
use model::chat::{ConversationRecord, MessageWithAttachments};
use sqlx::{Pool, Postgres};

#[derive(Clone)]
pub struct DcsClient {
    chat_repo: PgChatRepo,
    db: Pool<Postgres>,
}

impl DcsClient {
    pub fn new(db: Pool<Postgres>) -> Self {
        let chat_repo = PgChatRepo::new(db.clone());
        Self { chat_repo, db }
    }
}

impl DcsClient {
    #[tracing::instrument(skip(self), err)]
    pub async fn get_chat_history(&self, chat_id: &str) -> Result<ChatHistory> {
        let chat = self
            .chat_repo
            .get_chat(chat_id)
            .await
            .map_err(|e| anyhow::anyhow!("failed to get chat: {e}"))?;

        let messages = chat
            .messages
            .into_iter()
            .map(|m| {
                let content = match m.content {
                    ai::types::ChatMessageContent::Text(s) => s,
                    other => serde_json::to_string(&other).unwrap_or_default(),
                };
                MessageWithAttachments {
                    content,
                    date: chrono::Utc::now(),
                    attachment_ids: m
                        .attachments
                        .iter()
                        .map(|a| a.attachment_id.clone())
                        .collect(),
                }
            })
            .collect();

        Ok(ChatHistory {
            conversation: vec![ConversationRecord {
                chat_id: chat.id,
                title: chat.name,
                messages,
            }],
        })
    }

    /// Get chat history for specific message IDs (may span multiple chats).
    #[tracing::instrument(skip(self), err)]
    pub async fn get_chat_history_for_messages(
        &self,
        message_ids: &[String],
    ) -> Result<ChatHistory> {
        macro_db_client::chat_history::get_chat_history_for_messages(&self.db, message_ids).await
    }
}
