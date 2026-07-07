use crate::{
    OpensearchClient, Result, delete,
    upsert::{self, BulkUpsertResult, email::UpsertEmailArgs, properties::IndexedProperty},
};

impl OpensearchClient {
    /// Upserts an email message into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_email_message(&self, upsert_email_args: &UpsertEmailArgs) -> Result<()> {
        upsert::email::upsert_email_message(&self.inner, upsert_email_args).await
    }

    /// Bulk upserts email messages into the opensearch index
    #[tracing::instrument(skip(self, messages))]
    pub async fn bulk_upsert_email_messages(
        &self,
        messages: &[UpsertEmailArgs],
        index_override: Option<&str>,
    ) -> Result<BulkUpsertResult> {
        upsert::email::bulk_upsert_email_messages(&self.inner, messages, index_override).await
    }

    /// Refresh only the denormalized `properties` on every message doc of a
    /// thread.
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn update_email_thread_properties(
        &self,
        thread_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        upsert::email::update_email_thread_properties(&self.inner, thread_id, properties).await
    }

    /// Deletes a particular email message
    pub async fn delete_email_message_by_id(&self, message_id: &str) -> Result<()> {
        delete::email::delete_email_message_by_id(&self.inner, message_id).await
    }

    /// Deletes all email messages with the specified link_id
    pub async fn delete_email_messages_by_link_id(&self, link_id: &str) -> Result<()> {
        delete::email::delete_email_by_link_id(&self.inner, link_id).await
    }

    pub async fn delete_email_messages_by_user_id(&self, user_id: &str) -> Result<()> {
        delete::email::delete_email_by_user_id(&self.inner, user_id).await
    }
}
