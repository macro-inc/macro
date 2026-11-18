use super::database_error::{database_error, is_unstorable};
use super::*;
use email::domain::mailbox::inbox_sync::{InboxSyncResync, MessageResyncRepository};
use models_email::service::{
    message::{Message, SimpleMessage},
    thread::ThreadProviderMap,
};
use std::collections::HashSet;

fn skipped(
    rows: Vec<email_db_client::messages::insert::SkippedMessage>,
) -> Vec<SkippedBackfillMessage> {
    rows.into_iter()
        .map(|row| SkippedBackfillMessage {
            index: row.index,
            error: row.error,
        })
        .collect()
}
impl MessageResyncRepository for PgBackfillWorker {
    type ResyncError = BackfillDatabaseError;
    async fn resync_labels(&self, message: Uuid) -> Result<Vec<String>, Self::ResyncError> {
        Ok(
            email_db_client::labels::get::fetch_message_labels(&self.jobs.0, message)
                .await
                .map_err(database_error)?
                .into_iter()
                .map(|label| label.provider_label_id)
                .collect(),
        )
    }
    async fn resync_pending_labels(&self, message: Uuid) -> Result<Vec<String>, Self::ResyncError> {
        email_db_client::labels::pending_writes::pending_provider_label_ids(&self.jobs.0, message)
            .await
            .map_err(|e| database_error(e.into()))
    }
}
impl BackfillImportRepository for PgBackfillWorker {
    async fn retrieved_threads(&self, job: Uuid, count: i32) -> Result<(), BackfillDatabaseError> {
        email_db_client::backfill::job::update::update_job_threads_retrieved_count(
            &self.jobs.0,
            job,
            count,
        )
        .await
        .map_err(database_error)
    }
    async fn existing_threads(
        &self,
        link: Uuid,
        provider: &str,
    ) -> Result<ThreadProviderMap, BackfillDatabaseError> {
        email_db_client::threads::get::get_threads_by_link_id_and_provider_ids(
            &self.jobs.0,
            link,
            &HashSet::from_iter(vec![provider.to_string()]),
        )
        .await
        .map_err(database_error)
    }
    async fn existing_messages(
        &self,
        link: Uuid,
        providers: &[String],
    ) -> Result<HashSet<String>, BackfillDatabaseError> {
        email_db_client::messages::get::filter_existing_provider_message_ids(
            &self.jobs.0,
            link,
            providers,
        )
        .await
        .map_err(database_error)
    }
    async fn stored_message(
        &self,
        link: Uuid,
        provider: &str,
    ) -> Result<Option<SimpleMessage>, BackfillDatabaseError> {
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &self.jobs.0,
            provider,
            &link,
        )
        .await
        .map_err(database_error)
    }
    async fn insert_thread(
        &self,
        link: Uuid,
        provider: &str,
        messages: &mut [Message],
    ) -> Result<Option<(Uuid, Vec<SkippedBackfillMessage>)>, BackfillDatabaseError> {
        email_db_client::threads::insert::insert_backfilled_thread(
            &self.jobs.0,
            provider,
            link,
            messages,
            is_unstorable,
        )
        .await
        .map(|row| row.map(|(id, rows)| (id, skipped(rows))))
        .map_err(database_error)
    }
    async fn insert_messages(
        &self,
        link: Uuid,
        thread: Uuid,
        messages: &mut [Message],
    ) -> Result<Vec<SkippedBackfillMessage>, BackfillDatabaseError> {
        email_db_client::messages::insert::insert_thread_messages(
            &self.jobs.0,
            thread,
            link,
            messages,
            is_unstorable,
        )
        .await
        .map(skipped)
        .map_err(database_error)
    }
    async fn insert_message(
        &self,
        link: Uuid,
        thread: Uuid,
        message: &mut Message,
        snapshot: Option<&InboxSyncResync>,
    ) -> Result<(), BackfillDatabaseError> {
        let snapshot = snapshot.map(
            |snapshot| email_db_client::messages::insert::ResyncSnapshot {
                stored_labels: snapshot.stored_labels.clone(),
                pending_labels: snapshot.pending_labels.clone(),
            },
        );
        email_db_client::messages::insert::insert_message(
            &self.jobs.0,
            thread,
            message,
            link,
            false,
            snapshot.as_ref(),
        )
        .await
        .map_err(database_error)
    }
    async fn invitation_message(
        &self,
        link: Uuid,
        provider: &str,
    ) -> Result<(Uuid, Uuid), BackfillDatabaseError> {
        email_db_client::messages::get::get_message_and_thread_id_by_provider_id(
            &self.jobs.0,
            link,
            provider,
        )
        .await
        .map_err(database_error)
    }
}
