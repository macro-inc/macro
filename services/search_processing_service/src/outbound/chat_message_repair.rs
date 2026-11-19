//! Adapters for the deleted chat message repair: the chats index's message
//! documents, and lookups of the chat tables.

use std::{collections::HashSet, sync::Arc};

use opensearch_client::{OpensearchClient, chat_message_repair, error::OpensearchClientError};
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::{
    chat_message_repair::{
        ChatMessageIndex, ChatRows, IndexedChatMessage, MessageDelete, MessageIndexError,
    },
    email_attachment_status::PageSize,
};

#[cfg(test)]
mod test;

pub struct OpenSearchChatMessages(pub Arc<OpensearchClient>);

impl ChatMessageIndex for OpenSearchChatMessages {
    async fn page_after(
        &self,
        after_message_id: Option<&str>,
        limit: PageSize,
    ) -> Result<Vec<IndexedChatMessage>, MessageIndexError> {
        let page = self
            .0
            .chat_messages_after(after_message_id, limit.get())
            .await
            .map_err(|error| {
                if error.refusal().is_some() {
                    MessageIndexError::Refused(error.to_string())
                } else {
                    MessageIndexError::Internal(Report::new(error).into_dynamic())
                }
            })?;
        Ok(page
            .into_iter()
            .map(|message| IndexedChatMessage {
                chat_id: message.chat_id,
                message_id: message.message_id,
            })
            .collect())
    }

    async fn delete(
        &self,
        messages: &[IndexedChatMessage],
    ) -> Result<MessageDelete, MessageIndexError> {
        let messages: Vec<_> = messages
            .iter()
            .map(|message| chat_message_repair::IndexedChatMessage {
                chat_id: message.chat_id.clone(),
                message_id: message.message_id.clone(),
            })
            .collect();
        let result = self
            .0
            .delete_indexed_chat_messages(&messages)
            .await
            .map_err(|error| {
                if error.refusal().is_some() {
                    MessageIndexError::Refused(error.to_string())
                } else if let OpensearchClientError::BulkItemsFailed { .. } = error {
                    MessageIndexError::ItemsFailed(error.to_string())
                } else {
                    MessageIndexError::Internal(Report::new(error).into_dynamic())
                }
            })?;

        Ok(MessageDelete {
            deleted: result.deleted,
            not_found: result.not_found,
        })
    }
}

/// Lookups of `ChatMessage` and `Chat` by primary key, one statement per
/// batch of ids.
pub struct PgChatRows {
    db: PgPool,
}

impl PgChatRows {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl ChatRows for PgChatRows {
    #[tracing::instrument(skip_all, fields(message_count = message_ids.len()), err(Debug))]
    async fn existing_messages(&self, message_ids: &[String]) -> Result<HashSet<String>, Report> {
        let mut transaction = self.db.begin().await?;
        // One primary key probe per id, a page of at most 1000; give up well
        // before a slow lookup holds the job.
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;
        let ids = sqlx::query_scalar!(
            r#"SELECT id FROM "ChatMessage" WHERE id = ANY($1)"#,
            message_ids
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(ids.into_iter().collect())
    }

    #[tracing::instrument(skip_all, fields(chat_count = chat_ids.len()), err(Debug))]
    async fn existing_chats(&self, chat_ids: &[String]) -> Result<HashSet<String>, Report> {
        let mut transaction = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *transaction)
            .await?;
        let ids = sqlx::query_scalar!(r#"SELECT id FROM "Chat" WHERE id = ANY($1)"#, chat_ids)
            .fetch_all(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(ids.into_iter().collect())
    }
}
