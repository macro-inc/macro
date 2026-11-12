//! Existing inbox-sync persistence, provider and queue calls behind domain ports.

mod import_effects;
mod import_repository;
#[cfg(test)]
mod integration_test;
mod notifications;
pub(crate) mod pending_labels;
mod repository;
mod transaction;

use crate::outbound::email_api::GmailApi;
use crate::outbound::message_labels::gmail_ops::PgGmailOps;
use crate::outbound::persistence_error::InboxPersistenceError;
use crate::pubsub::context::PubSubContext;
use email::domain::mailbox::inbox_sync::*;
use email_api_client::domain::models::EmailApiError;
use futures::future::BoxFuture;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use models_email::api::refresh::RefreshEmailEvent;
use models_email::gmail::inbox_sync::InboxSyncPubsubMessage;
use models_email::service::link::Link;
use sqlx::PgPool;
use uuid::Uuid;

pub(crate) type InboxSync =
    InboxSyncService<PgGmailOps, PgInboxSync, GmailInboxSync, InboxSyncSqs, InboxSyncEffects>;

#[derive(Clone)]
pub(crate) struct PgInboxSync(pub PgPool);
#[derive(Clone)]
pub(crate) struct GmailInboxSync(pub GmailApi);
#[derive(Clone)]
pub(crate) struct InboxSyncSqs(pub sqs_client::SQS);
#[derive(Clone)]
pub(crate) struct InboxSyncEffects {
    pub worker: PubSubContext,
}

impl InboxSyncGmail for GmailInboxSync {
    fn message_labels<'a>(
        &'a self,
        link_id: Uuid,
        provider_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<String>>, EmailApiError>> {
        Box::pin(self.0.get_message_label_ids(link_id, provider_id))
    }
}

impl InboxSyncQueue for InboxSyncSqs {
    type Err = InboxPersistenceError;

    async fn enqueue(&self, message: InboxSyncPubsubMessage) -> Result<(), Self::Err> {
        self.0
            .enqueue_gmail_inbox_sync_notification(message)
            .await
            .map_err(Into::into)
    }

    async fn enqueue_backfill(
        &self,
        message: models_email::service::backfill::BackfillPubsubMessage,
    ) -> Result<(), Self::Err> {
        self.0
            .enqueue_email_backfill_message(message)
            .await
            .map_err(Into::into)
    }

    async fn enqueue_retry(&self, message: InboxSyncPubsubMessage) -> Result<(), Self::Err> {
        self.0
            .enqueue_gmail_retry_inbox_sync_notification(message)
            .await
            .map_err(Into::into)
    }
}

impl MacroEventBroker for InboxSyncEffects {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.worker.macro_event_broker.send_event(event)
    }
}

impl InboxSyncRefresher for InboxSyncEffects {
    async fn refresh(&self, owner: &str, event: InboxSyncRefresh) {
        let event = match event {
            InboxSyncRefresh::UpsertMessage(link_id) => {
                RefreshEmailEvent::UpsertMessage { link_id }
            }
            InboxSyncRefresh::DeleteMessage(link_id) => {
                RefreshEmailEvent::DeleteMessage { link_id }
            }
            InboxSyncRefresh::UpdateLabels(link_id) => RefreshEmailEvent::UpdateLabels { link_id },
        };
        crate::pubsub::util::cg_refresh_email(&self.worker.connection_gateway_client, owner, event)
            .await;
    }
}

impl InboxSyncImportGmail for GmailInboxSync {
    fn catalog(
        &self,
        link: Uuid,
    ) -> BoxFuture<'_, Result<Vec<models_email::service::label::Label>, EmailApiError>> {
        Box::pin(self.0.list_labels(link))
    }
    fn changes<'a>(
        &'a self,
        link: Uuid,
        cursor: &'a email_api_client::domain::models::SyncCursor,
    ) -> BoxFuture<'a, Result<email_api_client::domain::models::ChangeBatch, EmailApiError>> {
        Box::pin(self.0.list_changes(link, cursor))
    }
    fn message<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<
        'a,
        Result<Option<email_api_client::domain::models::MessageWithCalendarParts>, EmailApiError>,
    > {
        Box::pin(self.0.get_message(link, provider))
    }
    fn thread<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<
        'a,
        Result<Vec<email_api_client::domain::models::MessageWithCalendarParts>, EmailApiError>,
    > {
        Box::pin(self.0.get_thread(link, provider))
    }
}
