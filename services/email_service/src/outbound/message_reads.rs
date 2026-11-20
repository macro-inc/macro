//! Existing synced-mail queries, with their results and errors left intact.

use email::domain::message_reads::MessageReadRepository;
use models_email::service::message::{MessageSenderInfo, ParsedMessage, ThreadHistoryInfo};
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

pub struct PgMessageReads(pub sqlx::PgPool);

/// A typed port error whose original value is restored before HTTP error logging.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct MessageReadPersistenceError(#[from] anyhow::Error);

impl MessageReadPersistenceError {
    pub fn into_inner(self) -> anyhow::Error {
        self.0
    }
}

impl MessageReadRepository for PgMessageReads {
    type Err = MessageReadPersistenceError;

    async fn message(&self, id: Uuid) -> Result<Option<ParsedMessage>, Self::Err> {
        Ok(email_db_client::messages::get_parsed::get_parsed_message_by_id(&self.0, &id).await?)
    }

    async fn messages(&self, ids: &[Uuid]) -> Result<Vec<ParsedMessage>, Self::Err> {
        Ok(
            email_db_client::messages::get_parsed::get_parsed_messages_by_id_batch(&self.0, ids)
                .await?,
        )
    }

    async fn thread_messages(
        &self,
        id: Uuid,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<ParsedMessage>, Self::Err> {
        Ok(
            email_db_client::messages::get_parsed::get_paginated_parsed_messages_by_thread_id(
                &self.0, id, offset, limit,
            )
            .await?,
        )
    }

    async fn readable_inbox_ids(&self, caller: &str) -> Result<Vec<Uuid>, Self::Err> {
        Ok(
            email_db_client::links::get::fetch_inboxes_for_macro_id(&self.0, caller)
                .await?
                .into_iter()
                .map(|link| link.id)
                .collect(),
        )
    }

    async fn newest_owned_inbox(&self, caller: &str) -> Result<Option<Uuid>, Self::Err> {
        Ok(
            email_db_client::links::get::fetch_link_by_macro_id(&self.0, caller)
                .await?
                .map(|link| link.id),
        )
    }

    async fn senders(
        &self,
        inboxes: &[Uuid],
        ids: &[Uuid],
    ) -> Result<HashMap<Uuid, MessageSenderInfo>, Self::Err> {
        Ok(
            email_db_client::messages::get::get_message_sender_and_pretty_sender(
                &self.0, inboxes, ids,
            )
            .await?,
        )
    }

    async fn histories(
        &self,
        inboxes: &[Uuid],
        ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ThreadHistoryInfo>, Self::Err> {
        Ok(email_db_client::user_history::get_thread_summary_info(&self.0, inboxes, ids).await?)
    }

    async fn thread_owner(&self, id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok(email_db_client::threads::get::get_macro_id_from_thread_id(&self.0, id).await?)
    }
}
