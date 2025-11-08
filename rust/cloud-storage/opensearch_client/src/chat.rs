use crate::{
    OpensearchClient, Result, delete,
    search::chats::{ChatSearchResponse, search_chats},
    upsert::{self, chat_message::UpsertChatMessageArgs},
};

impl OpensearchClient {
    #[tracing::instrument(skip(self))]
    pub async fn upsert_chat_message(
        &self,
        upsert_chat_message_args: &UpsertChatMessageArgs,
    ) -> Result<()> {
        upsert::chat_message::upsert_chat_message(&self.inner, upsert_chat_message_args).await
    }

    /// Deletes a chat from the opensearch chat index
    /// This will remove all messages for a given chat
    #[tracing::instrument(skip(self))]
    pub async fn delete_chat(&self, chat_id: &str) -> Result<()> {
        delete::chat::delete_chat_by_id(&self.inner, chat_id).await
    }

    /// Deletes a chat message from the opensearch chat index
    /// This removes a specific message from a chat
    #[tracing::instrument(skip(self))]
    pub async fn delete_chat_message(&self, chat_id: &str, chat_message_id: &str) -> Result<()> {
        delete::chat::delete_chat_message_by_id(&self.inner, chat_id, chat_message_id).await
    }

    /// Searches for chats in the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn search_chats(
        &self,
        args: crate::search::chats::ChatSearchArgs,
    ) -> Result<Vec<ChatSearchResponse>> {
        search_chats(&self.inner, args).await
    }

    pub async fn update_chat_metadata(&self, chat_id: &str, title: &str) -> Result<()> {
        upsert::chat_message::update_chat_metadata(&self.inner, chat_id, title).await
    }

    pub async fn delete_chat_by_user_id(&self, user_id: &str) -> Result<()> {
        delete::chat::delete_chat_by_user_id(&self.inner, user_id).await
    }
}
