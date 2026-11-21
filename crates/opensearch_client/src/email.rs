use crate::{
    OpensearchClient, Result, delete,
    error::OpensearchClientError,
    retry::resend_on_lost_connection,
    upsert::{
        self, BulkUpsertResult,
        email::UpsertEmailArgs,
        properties::{IndexedProperty, PropertyUpdate},
    },
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
    ) -> Result<PropertyUpdate> {
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
    /// background OpenSearch task and returns its id without waiting, or
    /// returns the delete already running for that inbox, so a retry, a second
    /// delivery of the same event, or a start whose response was lost adopts
    /// the running task. Listing and starting are separate requests, so two
    /// starts racing for one inbox can still start two tasks.
    ///
    /// The start itself is not resent after a lost connection: OpenSearch may
    /// already have accepted it, so the running tasks are read again instead.
    /// The span's `start` field says which: `adopted`, `started`, or
    /// `adopted_after_lost_connection`.
    #[tracing::instrument(skip(self), fields(start = tracing::field::Empty), err)]
    pub async fn start_email_link_delete(
        &self,
        link_id: &str,
        docs_per_second: i64,
    ) -> Result<delete::email::EmailDeleteTaskId> {
        let span = tracing::Span::current();
        if let Some(running) = self.running_email_link_delete(link_id).await? {
            span.record("start", "adopted");
            return Ok(running);
        }
        match delete::email::start_email_link_delete(&self.inner, link_id, docs_per_second).await {
            Err(error @ OpensearchClientError::RequestFailed { .. }) => {
                match self.running_email_link_delete(link_id).await {
                    Ok(Some(running)) => {
                        span.record("start", "adopted_after_lost_connection");
                        Ok(running)
                    }
                    Ok(None) => Err(error),
                    Err(listing_error) => {
                        tracing::warn!(error = ?listing_error, "could not list running deletes after a lost start");
                        Err(error)
                    }
                }
            }
            started => {
                if started.is_ok() {
                    span.record("start", "started");
                }
                started
            }
        }
    }

    /// Refreshes the email index, so a following search or delete-by-query
    /// sees every write so far.
    pub async fn refresh_email_index(&self) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::email::refresh_index(
                &self.inner,
                models_opensearch::SearchIndex::Emails.as_ref(),
            )
        })
        .await
    }

    /// The inbox delete task OpenSearch is running for `link_id`, if any.
    async fn running_email_link_delete(
        &self,
        link_id: &str,
    ) -> Result<Option<delete::email::EmailDeleteTaskId>> {
        resend_on_lost_connection(|| delete::email::running_email_link_delete(&self.inner, link_id))
            .await
    }

    /// Reads a background email delete task's progress, or `None` when
    /// OpenSearch knows no task by that id.
    pub async fn email_delete_task(
        &self,
        task_id: &delete::email::EmailDeleteTaskId,
    ) -> Result<Option<delete::email::EmailDeleteTask>> {
        resend_on_lost_connection(|| delete::email::email_delete_task(&self.inner, task_id)).await
    }

    pub async fn delete_email_messages_by_user_id(&self, user_id: &str) -> Result<()> {
        resend_on_lost_connection(|| delete::email::delete_email_by_user_id(&self.inner, user_id))
            .await
    }
}
