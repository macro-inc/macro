//! Running one population from the queue and deciding what happens to its message.

use super::backoff::{self, FAILED, TEAM_BUSY};
use super::ports::{
    PendingContact, PendingContacts, PopulationMailboxes, PopulationQueue, PopulationSlots,
    SettledContact,
};
use super::requests::CrmPopulationRequests;
use crate::domain::backfill_jobs::worker::{BackfillCrm, BackfillWritePermit};
use crm::domain::model::CrmError;
use models_email::service::backfill::{PopulateCrmContactPayload, PopulateCrmPolicyPayload};
use models_email::service::crm_population::{CrmPopulationContact, CrmPopulationMessage};
use models_email::service::link::Link;
use std::time::Duration;
use uuid::Uuid;

/// Failed attempts after which a population is given up. A contact comes
/// back with its next mail; a history page is published again by its outbox.
pub const MAX_ATTEMPTS: u32 = 6;

/// Deliveries after which a population with no attempt count of its own (a
/// history page, or a contact whose entry is gone) is given up. Deliveries
/// also count refusals of a busy team, so this leaves room for those.
pub const MAX_DELIVERIES: u32 = 30;

/// Whether a worker may take its next message.
pub enum FleetAdmission<Slot> {
    /// A fleet slot, held while the worker receives and runs one message.
    Admitted(Slot),
    /// The fleet runs as many populations as it may.
    Busy,
    /// The slots could not be read.
    Unavailable,
}

/// What the listener does with a delivered message.
#[derive(Debug, PartialEq, Eq)]
pub enum PopulationDisposition {
    /// Delete it: done, superseded, or given up.
    Done,
    /// Hide it for `after`. It stays at the head of its mailbox's group, so
    /// the mailbox's other populations wait with it.
    Retry {
        /// How long to hide the message.
        after: Duration,
    },
    /// Leave it for the queue's visibility timeout.
    LeaveForRedelivery,
}

/// Runs CRM populations delivered by the population queue.
pub struct CrmPopulationService<P, Q, S, M, C> {
    /// Pending entries and the queue, shared with producers.
    pub requests: CrmPopulationRequests<P, Q>,
    /// Each team's population slots.
    pub slots: S,
    /// Mailbox reads.
    pub mailboxes: M,
    /// The CRM domain operations.
    pub crm: C,
}

/// How a message was handled, recorded once on its span.
struct Handled {
    disposition: PopulationDisposition,
    outcome: &'static str,
    defer_reason: Option<&'static str>,
    attempt: Option<u32>,
}

impl Handled {
    fn done(outcome: &'static str) -> Self {
        Self {
            disposition: PopulationDisposition::Done,
            outcome,
            defer_reason: None,
            attempt: None,
        }
    }

    fn retry(reason: &'static str, after: Duration, attempt: Option<u32>) -> Self {
        Self {
            disposition: PopulationDisposition::Retry { after },
            outcome: "deferred",
            defer_reason: Some(reason),
            attempt,
        }
    }

    fn left(outcome: &'static str) -> Self {
        Self {
            disposition: PopulationDisposition::LeaveForRedelivery,
            outcome,
            defer_reason: None,
            attempt: None,
        }
    }

    fn with_attempt(mut self, attempt: u32) -> Self {
        self.attempt = Some(attempt);
        self
    }
}

/// Why a failed population may succeed later, or `None` when the CRM
/// refused it and retrying cannot help.
fn retry_reason(error: &CrmError) -> Option<&'static str> {
    match error {
        CrmError::Contended => Some("contended"),
        CrmError::StorageLayerError(_) => Some("storage"),
        _ => None,
    }
}

impl<P, Q, S, M, C> CrmPopulationService<P, Q, S, M, C>
where
    P: PendingContacts,
    Q: PopulationQueue,
    S: PopulationSlots,
    M: PopulationMailboxes,
    C: BackfillCrm,
{
    /// One of the fleet's population slots, if one is free now. A worker
    /// holds it while it receives and runs a message, so a busy fleet leaves
    /// messages queued rather than receiving and hiding them, which would
    /// spend their deliveries. While it waits the worker holds no message and
    /// no database connection.
    pub async fn fleet_slot(&self) -> FleetAdmission<S::Slot> {
        match self.slots.fleet().await {
            Ok(Some(slot)) => FleetAdmission::Admitted(slot),
            Ok(None) => FleetAdmission::Busy,
            Err(error) => {
                tracing::warn!(error = ?error, "could not reach the CRM population fleet slots");
                FleetAdmission::Unavailable
            }
        }
    }

    /// Runs one delivered message; `receive_count` counts this delivery.
    #[tracing::instrument(
        name = "crm.population.consume",
        skip_all,
        fields(
            link_id = %message.link_id(),
            receive_count = receive_count,
            operation = tracing::field::Empty,
            team_id = tracing::field::Empty,
            outcome = tracing::field::Empty,
            defer_reason = tracing::field::Empty,
            attempt = tracing::field::Empty,
        )
    )]
    pub async fn process(
        &self,
        message: &CrmPopulationMessage,
        receive_count: u32,
    ) -> PopulationDisposition {
        let span = tracing::Span::current();
        let handled = match message {
            CrmPopulationMessage::Contact(contact) => {
                span.record("operation", "contact");
                self.contact(contact, receive_count).await
            }
            CrmPopulationMessage::PolicyPage(page) => {
                span.record("operation", "policy_page");
                span.record("team_id", tracing::field::display(page.team_id));
                self.policy_page(page, receive_count).await
            }
        };
        span.record("outcome", handled.outcome);
        if let Some(reason) = handled.defer_reason {
            span.record("defer_reason", reason);
        }
        if let Some(attempt) = handled.attempt {
            span.record("attempt", attempt);
        }
        handled.disposition
    }

    async fn contact(&self, message: &CrmPopulationContact, receive_count: u32) -> Handled {
        let link = match self.mailboxes.link(message.link_id).await {
            Ok(Some(link)) => link,
            Ok(None) => return self.discard(message, "mailbox_gone").await,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the mailbox of a CRM population");
                return Handled::retry("lookup_failed", backoff::wait(FAILED, receive_count), None);
            }
        };
        let team = match self.crm.get_team_id_for_user(link.macro_id.as_ref()).await {
            Ok(Some(team)) => team,
            Ok(None) => return self.discard(message, "no_team").await,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the team of a CRM population");
                return Handled::retry("lookup_failed", backoff::wait(FAILED, receive_count), None);
            }
        };
        tracing::Span::current().record("team_id", tracing::field::display(team));

        match self.admit(team, receive_count).await {
            Ok(slot) => {
                slot.hold(self.populate(team, &link, message, receive_count))
                    .await
            }
            Err(refused) => refused,
        }
    }

    /// Ends a population that has nothing to do, with its pending entry:
    /// left behind, the entry would absorb every later request for the
    /// correspondent until it expired.
    async fn discard(&self, message: &CrmPopulationContact, outcome: &'static str) -> Handled {
        if let Err(error) = self
            .requests
            .pending
            .discard(message.link_id, &message.contact, message.claim)
            .await
        {
            tracing::warn!(error = ?error, "could not discard a pending CRM population");
        }
        Handled::done(outcome)
    }

    /// One of the team's slots, or the refusal to record. Never waits: a
    /// refused message is hidden and the worker moves on.
    async fn admit(&self, team: Uuid, receive_count: u32) -> Result<S::Slot, Handled> {
        let after = backoff::wait(TEAM_BUSY, receive_count);
        match self.slots.team(team).await {
            Ok(Some(slot)) => Ok(slot),
            Ok(None) => Err(Handled::retry("team_busy", after, None)),
            Err(error) => {
                tracing::warn!(error = ?error, "could not reach CRM population slots");
                Err(Handled::retry("slots_unavailable", after, None))
            }
        }
    }

    async fn populate(
        &self,
        team: Uuid,
        link: &Link,
        message: &CrmPopulationContact,
        receive_count: u32,
    ) -> Handled {
        let contact = &message.contact;
        let request = match self
            .requests
            .pending
            .take(link.id, contact, message.claim)
            .await
        {
            Ok(PendingContact::Claimed(hints)) => hints.apply(contact),
            Ok(PendingContact::Superseded) => return self.superseded(link.id, contact).await,
            Ok(PendingContact::Missing) => without_shortcut(contact),
            Err(error) => {
                tracing::warn!(error = ?error, "could not read a pending CRM population");
                return Handled::retry(
                    "pending_unavailable",
                    backoff::wait(FAILED, receive_count),
                    None,
                );
            }
        };

        let error = match self.crm.populate_contact(&team, link, &request).await {
            Ok(()) => return self.settle(link.id, message, "populated").await,
            Err(error) => error,
        };
        let Some(reason) = retry_reason(&error) else {
            tracing::warn!(error = ?error, "the CRM refused a population; dropping it");
            return self.settle(link.id, message, "rejected").await;
        };

        // An entry counts failed attempts exactly. Without one, deliveries
        // stand in for them, which also count a busy team's refusals.
        let (attempt, limit) = match self
            .requests
            .pending
            .fail(link.id, contact, message.claim)
            .await
        {
            Ok(Some(attempt)) => (attempt, MAX_ATTEMPTS),
            Ok(None) => (receive_count, MAX_DELIVERIES),
            Err(count_error) => {
                tracing::warn!(error = ?count_error, "could not count a failed CRM population");
                (receive_count, MAX_DELIVERIES)
            }
        };
        if attempt >= limit {
            tracing::error!(error = ?error, %team, reason, attempt, "giving up on a CRM population");
            return self
                .settle(link.id, message, "gave_up")
                .await
                .with_attempt(attempt);
        }
        Handled::retry(reason, backoff::wait(FAILED, attempt), Some(attempt))
    }

    /// Another queued message holds the entry, as after a duplicate delivery.
    /// This message's hints go to it like a new request, which sends a
    /// message only if that one has already finished.
    async fn superseded(&self, link_id: Uuid, contact: &PopulateCrmContactPayload) -> Handled {
        match self.requests.request(link_id, vec![contact.clone()]).await {
            Ok(()) => Handled::done("superseded"),
            Err(_) => Handled::left("superseded"),
        }
    }

    /// Ends the claim's turn. Requests that arrived during the run get one
    /// new message, at the back of the mailbox's group. If it can't be sent,
    /// or the settle's answer is lost, the entry goes back to this claim (a
    /// no-op unless it was handed to `next`) and the message is left to be
    /// delivered again, so those requests are not lost.
    async fn settle(
        &self,
        link_id: Uuid,
        message: &CrmPopulationContact,
        outcome: &'static str,
    ) -> Handled {
        let next = Uuid::now_v7();
        let pending = &self.requests.pending;
        let hints = match pending
            .settle(link_id, &message.contact, message.claim, next)
            .await
        {
            Ok(SettledContact::Cleared) => return Handled::done(outcome),
            Ok(SettledContact::Handed(hints)) => hints,
            Err(error) => {
                tracing::warn!(error = ?error, "could not settle a CRM population");
                return self.give_back(link_id, message, next, outcome).await;
            }
        };

        let handed = CrmPopulationMessage::Contact(CrmPopulationContact {
            link_id,
            claim: next,
            contact: hints.apply(&message.contact),
        });
        let Err(error) = self.requests.queue.send(vec![(next, handed)]).await else {
            return Handled::done(outcome);
        };
        tracing::warn!(error = ?error, "could not queue the requests that arrived during a CRM population");
        self.give_back(link_id, message, next, outcome).await
    }

    /// Hands the entry back from `next`, which has no message, to the claim
    /// whose redelivery will run it.
    async fn give_back(
        &self,
        link_id: Uuid,
        message: &CrmPopulationContact,
        next: Uuid,
        outcome: &'static str,
    ) -> Handled {
        if let Err(error) = self
            .requests
            .pending
            .restore(link_id, &message.contact, message.claim, next)
            .await
        {
            tracing::warn!(error = ?error, "could not restore a CRM population's pending entry");
        }
        Handled::left(outcome)
    }

    async fn policy_page(&self, page: &PopulateCrmPolicyPayload, receive_count: u32) -> Handled {
        let slot = match self.admit(page.team_id, receive_count).await {
            Ok(slot) => slot,
            Err(refused) => return refused,
        };
        let Err(error) = slot.hold(policy_history_page(&self.crm, page)).await else {
            return Handled::done("populated");
        };
        let Some(reason) = retry_reason(&error) else {
            tracing::warn!(error = ?error, "the CRM refused a history page; dropping it");
            return Handled::done("rejected");
        };
        if receive_count >= MAX_DELIVERIES {
            tracing::error!(error = ?error, reason, attempt = receive_count, "giving up on a CRM history page");
            return Handled::done("gave_up").with_attempt(receive_count);
        }
        Handled::retry(
            reason,
            backoff::wait(FAILED, receive_count),
            Some(receive_count),
        )
    }
}

/// The request with a latest date that defeats the CRM's "changes nothing"
/// shortcut for a known contact, for a message whose merged hints are gone.
/// The write recomputes every date and direction from stored mail, so only
/// the shortcut reads the hints. The direction stays the message's own: a
/// sent hint would make the CRM look up an unknown domain's company, and a
/// sent message lost with the merged hints comes back with the next one.
fn without_shortcut(contact: &PopulateCrmContactPayload) -> PopulateCrmContactPayload {
    PopulateCrmContactPayload {
        last_at: chrono::Utc::now(),
        ..contact.clone()
    }
}

/// One page of durable history. Completing the page means every contact
/// effect is durable, so it has no fan-out.
#[tracing::instrument(name = "crm.email_history.consume", skip_all, fields(team_id = %page.team_id, work_id = %page.work_id), err)]
async fn policy_history_page<C: BackfillCrm>(
    crm: &C,
    page: &PopulateCrmPolicyPayload,
) -> Result<(), CrmError> {
    let Some(history) = crm.policy_history_page(page).await? else {
        return Ok(());
    };
    for contact in &history.contacts {
        crm.populate_policy_contact(page, &history, contact).await?;
    }
    crm.finish_policy_history_page(page, &history).await
}
