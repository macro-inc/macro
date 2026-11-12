use super::*;
use models_email::{db, service};
use transaction::PgInboxSyncTransaction;

impl InboxSyncRepository for PgInboxSync {
    type Err = InboxPersistenceError;
    type Delete = PgInboxSyncTransaction;
    type Labels = PgInboxSyncTransaction;

    async fn begin_delete(&self) -> Result<Self::Delete, Self::Err> {
        self.0
            .begin()
            .await
            .map(PgInboxSyncTransaction)
            .map_err(anyhow::Error::from)
            .map_err(Into::into)
    }

    async fn begin_labels(&self) -> Result<Self::Labels, Self::Err> {
        self.0
            .begin()
            .await
            .map(PgInboxSyncTransaction)
            .map_err(anyhow::Error::from)
            .map_err(Into::into)
    }

    async fn message(
        &self,
        link_id: Uuid,
        provider_id: &str,
    ) -> Result<Option<service::message::SimpleMessage>, Self::Err> {
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &self.0,
            provider_id,
            &link_id,
        )
        .await
        .map_err(Into::into)
    }

    async fn labels(&self, message_id: Uuid) -> Result<Vec<db::label::Label>, Self::Err> {
        email_db_client::labels::get::fetch_message_labels(&self.0, message_id)
            .await
            .map_err(Into::into)
    }

    async fn pending_labels(&self, message_id: Uuid) -> Result<Vec<String>, Self::Err> {
        email_db_client::labels::pending_writes::pending_provider_label_ids(&self.0, message_id)
            .await
            .map_err(anyhow::Error::from)
            .map_err(Into::into)
    }

    async fn thread(
        &self,
        link_id: Uuid,
        thread_id: Uuid,
    ) -> Result<Option<service::thread::Thread>, Self::Err> {
        email_db_client::threads::get::get_thread_by_id_and_link_id(&self.0, thread_id, link_id)
            .await
            .map_err(Into::into)
    }
}
