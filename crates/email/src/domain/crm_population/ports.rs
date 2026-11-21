//! Storage, queue and admission capabilities of CRM population.

use crate::domain::backfill_jobs::worker::BackfillWritePermit;
use chrono::{DateTime, Utc};
use models_email::service::backfill::PopulateCrmContactPayload;
use models_email::service::crm_population::CrmPopulationMessage;
use models_email::service::link::Link;
use std::future::Future;
use uuid::Uuid;

/// What a correspondent's pending entry knows, merged from every request since
/// its population last started: the earliest and latest message, whether any
/// was sent by the mailbox, and the newest display name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactHints {
    /// Earliest message any merged request named.
    pub first_at: DateTime<Utc>,
    /// Latest message any merged request named.
    pub last_at: DateTime<Utc>,
    /// Whether any merged request came from mail the mailbox sent.
    pub is_sent: bool,
    /// The newest display name a request carried.
    pub name: Option<String>,
}

impl ContactHints {
    /// `contact` with these hints in place of its own.
    pub fn apply(self, contact: &PopulateCrmContactPayload) -> PopulateCrmContactPayload {
        PopulateCrmContactPayload {
            live_mail: contact.live_mail,
            contact_email: contact.contact_email.clone(),
            contact_name: self.name,
            first_at: self.first_at,
            last_at: self.last_at,
            is_sent: self.is_sent,
        }
    }
}

/// A pending entry, as the population holding `claim` finds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PendingContact {
    /// The entry belongs to this claim; its merged hints.
    Claimed(ContactHints),
    /// Another queued message holds the entry.
    Superseded,
    /// There is no entry: it expired, or the store lost it.
    Missing,
}

/// How a population's turn on its entry ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettledContact {
    /// No request arrived during the run, and the entry is gone.
    Cleared,
    /// Requests arrived during the run. The entry now belongs to the next
    /// claim, whose message must carry these hints.
    Handed(ContactHints),
}

/// One pending entry per mailbox, address and `live_mail`, holding merged
/// hints and the claim of the one queued message that will act on them.
pub trait PendingContacts: Send + Sync + 'static {
    /// Merges each request into its entry, and gives each entry no queued
    /// message covers yet to its request's claim. Returns, in order, whether
    /// each claim now holds its entry: `false` when a queued message absorbed
    /// the request. A request repeated in `requests` is absorbed by its first
    /// occurrence.
    fn record(
        &self,
        link: Uuid,
        requests: &[(Uuid, PopulateCrmContactPayload)],
    ) -> impl Future<Output = anyhow::Result<Vec<bool>>> + Send;
    /// Gives back claims whose messages may not have been sent, keeping their
    /// hints, so the next request for each sends one.
    fn release(
        &self,
        link: Uuid,
        claimed: &[(Uuid, PopulateCrmContactPayload)],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Starts `claim`'s run: requests merged from now on count as new.
    fn take(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> impl Future<Output = anyhow::Result<PendingContact>> + Send;
    /// Counts a failed run of `claim`. `None` when the entry is not its own.
    fn fail(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<u32>>> + Send;
    /// Ends `claim`'s turn: deletes the entry, or hands it to `next` when
    /// requests arrived during the run.
    fn settle(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> impl Future<Output = anyhow::Result<SettledContact>> + Send;
    /// Deletes the entry if `claim` holds it, for a mailbox that is gone or
    /// whose owner has no team: its requests mean nothing.
    fn discard(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Gives a handed entry back to `claim` after `next`'s message could not
    /// be sent, so a redelivery of `claim` finds it again.
    fn restore(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// The population queue, grouped by mailbox.
pub trait PopulationQueue: Send + Sync + 'static {
    /// Sends each message with its deduplication id. After an error some of
    /// them may have been sent.
    fn send(
        &self,
        messages: Vec<(Uuid, CrmPopulationMessage)>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Population slots shared by every worker of the fleet: a cap on the whole
/// fleet's populations, and one per team.
pub trait PopulationSlots: Send + Sync + 'static {
    /// A held slot, renewed while its population runs.
    type Slot: BackfillWritePermit;
    /// One of the fleet's slots if one is free now, without waiting.
    fn fleet(&self) -> impl Future<Output = anyhow::Result<Option<Self::Slot>>> + Send;
    /// One of the team's slots if one is free now, without waiting.
    fn team(&self, team: Uuid) -> impl Future<Output = anyhow::Result<Option<Self::Slot>>> + Send;
}

/// The mailbox a population runs for.
pub trait PopulationMailboxes: Send + Sync + 'static {
    /// The mailbox, unless it was deleted.
    fn link(&self, id: Uuid) -> impl Future<Output = anyhow::Result<Option<Link>>> + Send;
}
