//! Existing inbox-sync persistence, provider and queue calls behind domain ports.

mod repository;
mod transaction;

use crate::outbound::email_api::GmailApi;
use crate::outbound::message_labels::gmail_ops::PgGmailOps;
use crate::outbound::persistence_error::InboxPersistenceError;
use crate::pubsub::context::{PubSubContext, PubSubEventBroker};
use connection_gateway_client::client::ConnectionGatewayClient;
use email::domain::mailbox::inbox_sync::*;
use email_api_client::domain::models::EmailApiError;
use futures::future::BoxFuture;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use models_email::api::refresh::RefreshEmailEvent;
use models_email::gmail::inbox_sync::{
    GmailMessagePayload, InboxSyncPubsubMessage, UpsertMessagePayload,
};
use models_email::service::{link::Link, pubsub::ProcessingError};
use sqlx::PgPool;
use uuid::Uuid;

pub(crate) type InboxSync =
    InboxSyncService<PgGmailOps, PgInboxSync, GmailInboxSync, InboxSyncSqs, InboxSyncEffects>;

pub(crate) struct PgInboxSync(pub PgPool);
pub(crate) struct GmailInboxSync(pub GmailApi);
pub(crate) struct InboxSyncSqs(pub sqs_client::SQS);
pub(crate) struct InboxSyncEffects {
    pub broker: PubSubEventBroker,
    pub gateway: ConnectionGatewayClient,
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
        self.broker.send_event(event)
    }
}

impl InboxSyncRefresher for InboxSyncEffects {
    async fn refresh(&self, owner: &str, event: InboxSyncRefresh) {
        let event = match event {
            InboxSyncRefresh::DeleteMessage(link_id) => {
                RefreshEmailEvent::DeleteMessage { link_id }
            }
            InboxSyncRefresh::UpdateLabels(link_id) => RefreshEmailEvent::UpdateLabels { link_id },
        };
        crate::pubsub::util::cg_refresh_email(&self.gateway, owner, event).await;
    }
}

/// Stage A lends the current context to legacy calls so notification settings stay current.
#[derive(Clone)]
pub(crate) struct LegacyInboxSyncOperations(pub PubSubContext);

impl LegacyInboxSync for LegacyInboxSyncOperations {
    fn gmail_message<'a>(
        &'a self,
        link: &'a Link,
        payload: &'a GmailMessagePayload,
    ) -> BoxFuture<'a, Result<(), ProcessingError>> {
        Box::pin(crate::pubsub::inbox_sync::legacy_gmail_message(
            &self.0, link, payload,
        ))
    }

    fn upsert_message<'a>(
        &'a self,
        link: &'a Link,
        payload: &'a UpsertMessagePayload,
    ) -> BoxFuture<'a, Result<(), ProcessingError>> {
        Box::pin(crate::pubsub::inbox_sync::legacy_upsert_message(
            &self.0, link, payload,
        ))
    }
}
