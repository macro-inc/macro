use crate::{
    OpensearchClient, Result, delete,
    upsert::{self, BulkUpsertResult, email::UpsertEmailArgs},
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
