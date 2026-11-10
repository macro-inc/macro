use super::*;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::{db, service};
use sqlx::{Postgres, Transaction};

pub(crate) struct PgInboxSyncTransaction(pub Transaction<'static, Postgres>);

impl InboxSyncTransaction for PgInboxSyncTransaction {
    type Err = InboxPersistenceError;

    async fn complete<T: Send>(
        self,
        result: Result<T, ProcessingError>,
    ) -> Result<T, ProcessingError> {
        crate::pubsub::util::complete_transaction_with_processing_error(self.0, result).await
    }
}

impl InboxSyncDeleteTransaction for PgInboxSyncTransaction {
    async fn message_for_update(
        &mut self,
        link_id: Uuid,
        provider_id: &str,
    ) -> Result<Option<service::message::SimpleMessage>, Self::Err> {
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link_for_update(
            &mut self.0,
            provider_id,
            &link_id,
        )
        .await
        .map_err(Into::into)
    }

    async fn recipients(
        &mut self,
        message_id: Uuid,
    ) -> Result<Vec<(db::contact::Contact, db::address::EmailRecipientType)>, Self::Err> {
        email_db_client::contacts::get::fetch_db_recipients(&mut *self.0, message_id)
            .await
            .map_err(Into::into)
    }

    async fn sender(
        &mut self,
        message_id: Uuid,
    ) -> Result<Option<db::contact::Contact>, Self::Err> {
        email_db_client::contacts::get::get_sender_by_message_id(&mut *self.0, message_id)
            .await
            .map_err(Into::into)
    }

    async fn delete(
        &mut self,
        message: &service::message::SimpleMessage,
    ) -> Result<MessageDeletion, Self::Err> {
        use email_db_client::messages::delete::MessageDeletion as StoredDeletion;
        email_db_client::messages::delete::delete_message_with_tx(&mut self.0, message)
            .await
            .map(|deletion| match deletion {
                StoredDeletion::AlreadyDeleted => MessageDeletion::AlreadyDeleted,
                StoredDeletion::Deferred => MessageDeletion::Deferred,
                StoredDeletion::Deleted { deleted_thread } => {
                    MessageDeletion::Deleted { deleted_thread }
                }
            })
            .map_err(Into::into)
    }

    async fn cleanup_contacts(
        &mut self,
        link_id: Uuid,
        emails: Vec<String>,
    ) -> Result<(), ProcessingError> {
        email_db_client::crm_cleanup::candidates::insert_candidates(&mut *self.0, link_id, &emails)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to insert crm cleanup candidates"),
                })
            })?;

        Ok(())
    }
}

impl InboxSyncLabelTransaction for PgInboxSyncTransaction {
    async fn add_labels(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        labels: &[String],
    ) -> Result<(), Self::Err> {
        email_db_client::labels::insert::insert_message_labels(
            &mut self.0,
            link_id,
            message_id,
            labels,
            false,
            &[],
        )
        .await
        .map_err(Into::into)
    }

    async fn remove_labels(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        labels: &[String],
    ) -> Result<(), Self::Err> {
        email_db_client::labels::delete::delete_db_message_labels(
            &mut self.0,
            message_id,
            labels,
            link_id,
        )
        .await
        .map_err(Into::into)
    }

    async fn set_read(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        is_read: bool,
    ) -> Result<(), Self::Err> {
        email_db_client::messages::update::update_message_read_status(
            &mut self.0,
            message_id,
            link_id,
            is_read,
        )
        .await
        .map(|_| ())
        .map_err(Into::into)
    }

    async fn update_thread(&mut self, link_id: Uuid, thread_id: Uuid) -> Result<(), Self::Err> {
        email_db_client::threads::update::update_thread_metadata(&mut self.0, thread_id, link_id)
            .await
            .map_err(Into::into)
    }
}
