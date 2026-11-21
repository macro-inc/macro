//! Redis, SQS and Postgres adapters of CRM population.

use crate::util::redis::RedisClient;
use crate::util::redis::backfill_write_slots::BackfillWriteSlot;
use email::domain::crm_population::{
    CrmPopulationRequests, CrmPopulationService, PendingContact, PendingContacts,
    PopulationMailboxes, PopulationQueue, PopulationSlots, SettledContact,
};
use models_email::service::backfill::PopulateCrmContactPayload;
use models_email::service::crm_population::CrmPopulationMessage;
use models_email::service::link::Link;
use uuid::Uuid;

/// Pending entries in the email service's Redis.
#[derive(Clone)]
pub struct RedisPendingContacts(pub RedisClient);

/// The population queue through the shared SQS client.
#[derive(Clone)]
pub struct SqsPopulationQueue(pub sqs_client::SQS);

/// Each team's population slots in the email service's Redis.
pub(crate) struct RedisPopulationSlots(pub RedisClient);

/// Mailbox reads on the population pool.
pub(crate) struct PgPopulationMailboxes(pub sqlx::PgPool);

/// The requests every population producer shares.
pub type CrmPopulation = CrmPopulationRequests<RedisPendingContacts, SqsPopulationQueue>;

/// The composed population consumer.
pub(crate) type CrmPopulationConsumer = CrmPopulationService<
    RedisPendingContacts,
    SqsPopulationQueue,
    RedisPopulationSlots,
    PgPopulationMailboxes,
    crate::outbound::backfill_jobs::worker::BackfillWorkerCrm,
>;

/// Builds the producers' requests over Redis and the population queue.
pub fn requests(redis: RedisClient, sqs: sqs_client::SQS) -> CrmPopulation {
    CrmPopulationRequests {
        pending: RedisPendingContacts(redis),
        queue: SqsPopulationQueue(sqs),
    }
}

impl PendingContacts for RedisPendingContacts {
    async fn record(
        &self,
        link: Uuid,
        requests: &[(Uuid, PopulateCrmContactPayload)],
    ) -> anyhow::Result<Vec<bool>> {
        self.0.record_crm_population(link, requests).await
    }
    async fn release(
        &self,
        link: Uuid,
        claimed: &[(Uuid, PopulateCrmContactPayload)],
    ) -> anyhow::Result<()> {
        Ok(self.0.release_crm_population(link, claimed).await?)
    }
    async fn take(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> anyhow::Result<PendingContact> {
        self.0.take_crm_population(link, contact, claim).await
    }
    async fn fail(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> anyhow::Result<Option<u32>> {
        Ok(self.0.fail_crm_population(link, contact, claim).await?)
    }
    async fn settle(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> anyhow::Result<SettledContact> {
        self.0
            .settle_crm_population(link, contact, claim, next)
            .await
    }
    async fn discard(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> anyhow::Result<()> {
        Ok(self.0.discard_crm_population(link, contact, claim).await?)
    }
    async fn restore(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> anyhow::Result<()> {
        Ok(self
            .0
            .restore_crm_population(link, contact, claim, next)
            .await?)
    }
}

impl PopulationQueue for SqsPopulationQueue {
    async fn send(&self, messages: Vec<(Uuid, CrmPopulationMessage)>) -> anyhow::Result<()> {
        self.0.enqueue_crm_population_messages(&messages).await
    }
}

impl PopulationSlots for RedisPopulationSlots {
    type Slot = BackfillWriteSlot;
    async fn fleet(&self) -> anyhow::Result<Option<BackfillWriteSlot>> {
        Ok(self.0.try_acquire_crm_population_fleet_slot().await?)
    }
    async fn team(&self, team: Uuid) -> anyhow::Result<Option<BackfillWriteSlot>> {
        Ok(self.0.try_acquire_crm_population_slot(team).await?)
    }
}

impl PopulationMailboxes for PgPopulationMailboxes {
    async fn link(&self, id: Uuid) -> anyhow::Result<Option<Link>> {
        email_db_client::links::get::fetch_link_by_id(&self.0, id).await
    }
}
