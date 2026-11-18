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
    /// document changed after the page was read, so the caller rereads it,
    /// after refreshing the index so the reread sees the change.
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
        // A delete-by-query that deleted nothing forces no refresh, so the
        // reread would meet the same conflict, as with a document a
        // single-message delete removed by id moments before.
        if deleted.version_conflicts > 0
            && let Err(error) = resend_on_lost_connection(|| {
                delete::email::refresh_destination(&self.inner, index_override)
            })
            .await
        {
            tracing::warn!(error = ?error, "could not refresh the email index after a conflicted delete");
        }
        delete::email::fail_on_conflict(deleted).map(|_| ())
    }

    /// Deletes every document of one deleted email message, whatever thread
    /// it was indexed under. It forces a refresh only to recheck a copy that
    /// conflicted; search stops finding the message at the index's next
    /// scheduled refresh.
    #[tracing::instrument(
        skip(self),
        fields(
            deleted = tracing::field::Empty,
            other_threads = tracing::field::Empty,
            passes = tracing::field::Empty,
        ),
        err
    )]
    pub async fn delete_email_message(
        &self,
        message_id: &str,
        thread_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        let removed = resend_on_lost_connection(|| {
            delete::email::delete_email_message(&self.inner, message_id, thread_id, index_override)
        })
        .await?;
        let span = tracing::Span::current();
        span.record("deleted", removed.deleted());
        span.record("other_threads", removed.other_threads.deleted);
        span.record("passes", removed.other_threads.passes);
        Ok(())
    }

    /// Deletes all email messages with the specified link_id
    pub async fn delete_email_messages_by_link_id(&self, link_id: &str) -> Result<()> {
        resend_on_lost_connection(|| delete::email::delete_email_by_link_id(&self.inner, link_id))
            .await
    }

    pub async fn delete_email_messages_by_user_id(&self, user_id: &str) -> Result<()> {
        resend_on_lost_connection(|| delete::email::delete_email_by_user_id(&self.inner, user_id))
            .await
    }
}
