//! Existing backfill clients behind worker-domain capabilities.

#[cfg(test)]
mod test;

mod database_error;
mod effects;
mod imports;
mod lifecycle;
mod repository;
mod transaction;

use crate::outbound::email_api::GmailApi;
use crate::outbound::persistence_error::InboxPersistenceError;
use email::domain::backfill_jobs::worker::*;
use email_api_client::domain::models::{EmailApiError, MessageWithCalendarParts};
use futures::future::BoxFuture;
use models_email::service::backfill::BackfillPubsubMessage;
use uuid::Uuid;

pub(crate) type Backfill = BackfillService<
    PgBackfillWorker,
    GmailBackfill,
    BackfillSqs,
    BackfillWorkerEffects,
    BackfillWorkerCrm,
>;

pub(crate) struct PgBackfillWorker {
    pub jobs: super::PgBackfillJobs,
}
pub(crate) struct GmailBackfill(pub GmailApi);
pub(crate) struct BackfillSqs(pub sqs_client::SQS);
pub(crate) struct BackfillWorkerEffects {
    pub invitation_extractor: crate::composition::workers::EmailInvitationExtractor,
    pub db: sqlx::PgPool,
    pub sqs_client: sqs_client::SQS,
    pub contacts_ingress: std::sync::Arc<
        contacts::domain::service::SqsContactsIngress<
            contacts::outbound::ingress::SqsContactsQueue,
        >,
    >,
    pub email_api: GmailApi,
    pub redis_client: crate::util::redis::RedisClient,
    pub sfs_client: static_file_service_client::StaticFileServiceClient,
    pub connection_gateway_client: connection_gateway_client::client::ConnectionGatewayClient,
    pub dss_client: document_storage_service_client::DocumentStorageServiceClient,
    pub system_properties_service: std::sync::Arc<
        system_properties::SystemPropertiesServiceImpl<
            system_properties::PgSystemPropertiesRepository,
        >,
    >,
    pub macro_event_broker: crate::composition::workers::PubSubEventBroker,
}
pub(crate) struct BackfillWorkerCrm(pub crate::composition::workers::CrmServiceType);

impl BackfillGmail for GmailBackfill {
    fn labels(
        &self,
        link: Uuid,
    ) -> BoxFuture<'_, Result<Vec<models_email::service::label::Label>, EmailApiError>> {
        Box::pin(self.0.list_labels(link))
    }
    fn thread_count(&self, link: Uuid) -> BoxFuture<'_, Result<u64, EmailApiError>> {
        Box::pin(self.0.get_thread_count(link))
    }

    fn list_threads<'a>(
        &'a self,
        link: Uuid,
        limit: u32,
        next: Option<&'a str>,
        labels: &'a [&'a str],
    ) -> BoxFuture<'a, Result<email_api_client::domain::models::ThreadListPage, EmailApiError>>
    {
        Box::pin(self.0.list_threads(link, limit, next, labels))
    }
    fn list_messages<'a>(
        &'a self,
        link: Uuid,
        limit: u32,
        labels: &'a [&'a str],
    ) -> BoxFuture<'a, Result<Vec<String>, EmailApiError>> {
        Box::pin(self.0.list_messages(link, limit, labels))
    }
    fn thread<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Vec<MessageWithCalendarParts>, EmailApiError>> {
        Box::pin(self.0.get_thread(link, provider))
    }
    fn message<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Option<MessageWithCalendarParts>, EmailApiError>> {
        Box::pin(self.0.get_message(link, provider))
    }
}

impl BackfillQueue for BackfillSqs {
    type Err = InboxPersistenceError;
    async fn enqueue(&self, data: BackfillPubsubMessage) -> Result<(), Self::Err> {
        self.0
            .enqueue_email_backfill_message(data)
            .await
            .map_err(Into::into)
    }
    async fn defer(
        &self,
        data: &BackfillPubsubMessage,
        seconds: i32,
        deferrals: u32,
    ) -> Result<(), Self::Err> {
        self.0
            .defer_email_backfill_message(data, seconds, deferrals)
            .await
            .map_err(Into::into)
    }
}
