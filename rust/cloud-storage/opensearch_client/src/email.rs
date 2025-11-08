use crate::{
    OpensearchClient, Result, delete,
    search::emails::{EmailSearchArgs, EmailSearchResponse, search_emails},
    upsert::{self, email::UpsertEmailArgs},
};

impl OpensearchClient {
    /// Upserts an email message into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_email_message(&self, upsert_email_args: &UpsertEmailArgs) -> Result<()> {
        upsert::email::upsert_email_message(&self.inner, upsert_email_args).await
    }

    pub async fn search_emails(&self, args: EmailSearchArgs) -> Result<Vec<EmailSearchResponse>> {
        search_emails(&self.inner, args).await
    }

    /// Deletes all email messages with the specified thread_id
    pub async fn delete_email_by_thread_id(&self, thread_id: &str) -> Result<()> {
        delete::email::delete_email_by_thread_id(&self.inner, thread_id).await
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
