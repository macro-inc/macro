use crate::{
    OpensearchClient, Result, delete,
    error::OpensearchClientError,
    retry::resend_on_lost_connection,
    upsert::{
        self,
        email::{EmailDocumentKey, EmailWrites, UpsertEmailArgs},
    },
};

impl OpensearchClient {
    /// Writes `documents` and deletes `deletes` in one request, each fenced by
    /// `version` as an `external_gte` version: the index refuses any of them
    /// on a document that already holds a later version, and counts those in
    /// [`EmailWrites::refused_stale`] instead of failing the call.
    #[tracing::instrument(
        skip(self, documents, deletes),
        fields(
            documents = documents.len(),
            deletes = deletes.len(),
            indexed = tracing::field::Empty,
            deleted = tracing::field::Empty,
            refused_stale = tracing::field::Empty,
        ),
        err
    )]
    pub async fn write_email_documents(
        &self,
        version: u64,
        documents: &[UpsertEmailArgs],
        deletes: &[EmailDocumentKey],
        index_override: Option<&str>,
    ) -> Result<EmailWrites> {
        let writes = resend_on_lost_connection(|| {
            upsert::email::write_email_documents(
                &self.inner,
                version,
                documents,
                deletes,
                index_override,
            )
        })
        .await?;
        let span = tracing::Span::current();
        span.record("indexed", writes.indexed);
        span.record("deleted", writes.deleted);
        span.record("refused_stale", writes.refused_stale);
        Ok(writes)
    }

    /// The documents of `message_ids` under any thread but `keep_thread_ids`,
    /// as of the last refresh: a moved message's old copies, or, with no
    /// thread kept, every copy of a deleted message.
    #[tracing::instrument(
        skip(self, message_ids, keep_thread_ids),
        fields(
            messages = message_ids.len(),
            found = tracing::field::Empty,
        ),
        err
    )]
    pub async fn email_message_documents(
        &self,
        message_ids: &[String],
        keep_thread_ids: &[String],
        index_override: Option<&str>,
    ) -> Result<Vec<EmailDocumentKey>> {
        let found = resend_on_lost_connection(|| {
            delete::email::email_message_documents(
                &self.inner,
                message_ids,
                keep_thread_ids,
                index_override,
            )
        })
        .await?;
        tracing::Span::current().record("found", found.len());
        Ok(found)
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
