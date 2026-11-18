use crate::{
    OpensearchClient, Result, delete,
    retry::resend_on_lost_connection,
    upsert::{self, BulkUpsertResult, email::UpsertEmailArgs, properties::IndexedProperty},
};

impl OpensearchClient {
    /// Upserts an email message into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_email_message(&self, upsert_email_args: &UpsertEmailArgs) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::email::upsert_email_message(&self.inner, upsert_email_args)
        })
        .await
    }

    /// Bulk upserts email messages into the opensearch index
    #[tracing::instrument(skip(self, messages), err)]
    pub async fn bulk_upsert_email_messages(
        &self,
        messages: &[UpsertEmailArgs],
        index_override: Option<&str>,
    ) -> Result<BulkUpsertResult> {
        resend_on_lost_connection(|| {
            upsert::email::bulk_upsert_email_messages(&self.inner, messages, index_override)
        })
        .await
    }

    /// Refresh only the denormalized `properties` on every message doc of a
    /// thread.
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn update_email_thread_properties(
        &self,
        thread_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::email::update_email_thread_properties(&self.inner, thread_id, properties)
        })
        .await
    }

    /// Deletes every document of a thread page's spam and trash messages in
    /// one delete-by-query, visible to search when this returns. Fails when a
    /// document changed after the page was read, so the caller rereads it.
    #[tracing::instrument(
        skip(self, message_ids),
        fields(
            messages = message_ids.len(),
            deleted = tracing::field::Empty,
            version_conflicts = tracing::field::Empty,
        ),
        err
    )]
    pub async fn delete_email_messages(
        &self,
        message_ids: &[String],
        index_override: Option<&str>,
    ) -> Result<()> {
        let mut deleted = delete::email::DeletedByQuery::default();
        for chunk in message_ids.chunks(delete::email::MESSAGE_IDS_PER_DELETE) {
            deleted += resend_on_lost_connection(|| {
                delete::email::delete_email_messages(&self.inner, chunk, index_override)
            })
            .await?;
        }
        let span = tracing::Span::current();
        span.record("deleted", deleted.deleted);
        span.record("version_conflicts", deleted.version_conflicts);
        delete::email::fail_on_conflict(deleted).map(|_| ())
    }

    /// Deletes every document of one deleted email message, whatever thread
    /// it was indexed under, visible to search when this returns.
    #[tracing::instrument(
        skip(self),
        fields(deleted = tracing::field::Empty, passes = tracing::field::Empty),
        err
    )]
    pub async fn delete_email_message(
        &self,
        message_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        let deleted = resend_on_lost_connection(|| {
            delete::email::delete_email_message(&self.inner, message_id, index_override)
        })
        .await?;
        let span = tracing::Span::current();
        span.record("deleted", deleted.deleted);
        span.record("passes", deleted.passes);
        Ok(())
    }

    /// Deletes `message_id`'s documents under every thread but `thread_id`,
    /// the copies it left behind when it moved to another thread.
    #[tracing::instrument(
        skip(self),
        fields(deleted = tracing::field::Empty, passes = tracing::field::Empty),
        err
    )]
    pub async fn delete_email_message_outside_thread(
        &self,
        message_id: &str,
        thread_id: &str,
    ) -> Result<()> {
        let deleted = resend_on_lost_connection(|| {
            delete::email::delete_email_message_outside_thread(&self.inner, message_id, thread_id)
        })
        .await?;
        let span = tracing::Span::current();
        span.record("deleted", deleted.deleted);
        span.record("passes", deleted.passes);
        if deleted.deleted > 0 {
            tracing::info!(
                deleted = deleted.deleted,
                "removed a moved email message's copies under other threads"
            );
        }
        Ok(())
    }

    /// Starts deleting every email document of an inbox as a throttled
    /// background OpenSearch task and returns its id without waiting.
    #[tracing::instrument(skip(self), err)]
    pub async fn start_email_link_delete(
        &self,
        link_id: &str,
        docs_per_second: i64,
    ) -> Result<String> {
        resend_on_lost_connection(|| {
            delete::email::start_email_link_delete(&self.inner, link_id, docs_per_second)
        })
        .await
    }

    /// Reads a background email delete task's progress.
    pub async fn email_delete_task(&self, task_id: &str) -> Result<delete::email::EmailDeleteTask> {
        resend_on_lost_connection(|| delete::email::email_delete_task(&self.inner, task_id)).await
    }

    pub async fn delete_email_messages_by_user_id(&self, user_id: &str) -> Result<()> {
        resend_on_lost_connection(|| delete::email::delete_email_by_user_id(&self.inner, user_id))
            .await
    }
}
