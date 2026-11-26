use models_opensearch::SearchIndex;

use crate::{
    OpensearchClient, Result,
    chat_message_repair::{self, ChatMessageDeleteResult, IndexedChatMessage},
    delete,
    retry::resend_on_lost_connection,
    upsert::{
        self,
        chat_message::UpsertChatMessageArgs,
        properties::{IndexedProperty, PropertyUpdate},
    },
};

impl OpensearchClient {
    #[tracing::instrument(skip(self))]
    pub async fn upsert_chat_message(
        &self,
        upsert_chat_message_args: &UpsertChatMessageArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::chat_message::upsert_chat_message(
                &self.inner,
                upsert_chat_message_args,
                index_override,
            )
        })
        .await
    }

    /// Deletes a chat from the opensearch chat index
    /// This will remove all messages for a given chat
    #[tracing::instrument(skip(self))]
    pub async fn delete_chat(&self, chat_id: &str, index_override: Option<&str>) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::chat::delete_chat_by_id(&self.inner, chat_id, index_override)
        })
        .await
    }

    /// Deletes a chat message from the opensearch chat index
    /// This removes a specific message from a chat
    #[tracing::instrument(skip(self))]
    pub async fn delete_chat_message(
        &self,
        chat_id: &str,
        chat_message_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::chat::delete_chat_message_by_id(
                &self.inner,
                chat_id,
                chat_message_id,
                index_override,
            )
        })
        .await
    }

    pub async fn update_chat_metadata(&self, chat_id: &str, title: &str) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::chat_message::update_chat_metadata(&self.inner, chat_id, title)
        })
        .await
    }

    /// Refresh only the denormalized `properties` on an existing parent chat doc.
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn update_chat_properties(
        &self,
        chat_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<PropertyUpdate> {
        resend_on_lost_connection(|| {
            upsert::chat_message::update_chat_properties(&self.inner, chat_id, properties)
        })
        .await
    }

    pub async fn delete_chat_by_user_id(&self, user_id: &str) -> Result<()> {
        resend_on_lost_connection(|| delete::chat::delete_chat_by_user_id(&self.inner, user_id))
            .await
    }

    /// Up to `size` message documents of the chats index whose message id
    /// sorts after `after_message_id`, in message id order.
    #[tracing::instrument(skip(self), err)]
    pub async fn chat_messages_after(
        &self,
        after_message_id: Option<&str>,
        size: u16,
    ) -> Result<Vec<IndexedChatMessage>> {
        resend_on_lost_connection(|| {
            chat_message_repair::chat_messages_after(
                &self.inner,
                SearchIndex::Chats.as_ref(),
                after_message_id,
                size,
            )
        })
        .await
    }

    /// Delete these message documents from the chats index, leaving their
    /// chats. A refused request returns
    /// [`crate::error::OpensearchClientError::WritesRefused`] and a failed item
    /// [`crate::error::OpensearchClientError::BulkItemsFailed`]; stop on either,
    /// and back off when `refusal()` is set.
    #[tracing::instrument(skip(self, messages), fields(message_count = messages.len()), err)]
    pub async fn delete_indexed_chat_messages(
        &self,
        messages: &[IndexedChatMessage],
    ) -> Result<ChatMessageDeleteResult> {
        resend_on_lost_connection(|| {
            chat_message_repair::delete_chat_messages(
                &self.inner,
                SearchIndex::Chats.as_ref(),
                messages,
            )
        })
        .await
    }
}
