//! Existing backfill clients behind worker-domain capabilities.

mod database_error;
mod effects;
mod imports;
mod legacy;
mod repository;
mod transaction;

use crate::outbound::email_api::GmailApi;
use crate::outbound::persistence_error::InboxPersistenceError;
use crate::pubsub::context::PubSubContext;
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
    LegacyBackfillOperations,
>;

pub(crate) struct PgBackfillWorker {
    pub jobs: super::PgBackfillJobs,
}
pub(crate) struct GmailBackfill(pub GmailApi);
pub(crate) struct BackfillSqs(pub sqs_client::SQS);
pub(crate) struct BackfillWorkerEffects(pub PubSubContext);
pub(crate) struct BackfillWorkerCrm(pub crate::pubsub::context::CrmServiceType);
pub(crate) struct LegacyBackfillOperations(pub PubSubContext);

impl BackfillGmail for GmailBackfill {
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
