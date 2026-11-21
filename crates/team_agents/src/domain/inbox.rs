//! An agent teammate's own email inbox.
//!
//! The mailbox belongs to the agent's own Macro account; email_service
//! creates it at the provider and serves it ([`AgentMailboxes`]). This side
//! decides when an agent gets one, keeps one inbox per agent, and pauses or
//! releases it when the agent goes. The address lives only on the inbox,
//! never in the agent's account id.

use std::collections::HashMap;
use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The PostHog flag for agent inboxes, on top of agent teammates. Evaluated
/// for the acting admin; a rollout gate, never authorization.
pub const AGENT_INBOXES_FLAG: &str = "enable-agent-inboxes";

/// Where an agent's inbox is.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::AsRefStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentInboxState {
    /// Being created at the provider; email_service keeps trying.
    Provisioning,
    /// Receiving and sending.
    Active,
    /// Couldn't be created; see the failure. Adding it again retries.
    Failed,
    /// The agent was removed and email_service hasn't confirmed the pause
    /// yet; the inbox sweep keeps asking.
    Pausing,
    /// The agent was removed: nothing syncs or sends, mail is kept until
    /// it is released.
    Paused,
    /// Being deleted at the provider.
    Releasing,
    /// Deleted; the address no longer receives.
    Released,
}

/// Why an inbox couldn't be created.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::AsRefStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentInboxFailure {
    /// No email provider is set up on this server.
    NotConfigured,
    /// The address, and its fallback, are taken.
    AddressTaken,
    /// The provider account is out of inboxes.
    QuotaExceeded,
    /// The provider or email_service didn't answer.
    Unavailable,
    /// The provider refused the request.
    Rejected,
}

/// An agent's inbox, as admins see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentInbox {
    /// Its address, once the provider gave one.
    pub address: Option<String>,
    /// Where it is.
    pub state: AgentInboxState,
    /// Why it failed, with [`AgentInboxState::Failed`].
    pub failure: Option<AgentInboxFailure>,
    /// A stand-in provider serves it: no real mail moves.
    pub fake_provider: bool,
}

/// What email_service answers about an agent's mailbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxView {
    /// email_service's id for the mailbox.
    pub mailbox_id: Uuid,
    /// Its address, once the provider gave one.
    pub address: Option<String>,
    /// Where it is.
    pub state: AgentInboxState,
    /// Why it failed.
    pub last_error: Option<AgentInboxFailure>,
    /// A stand-in provider serves it.
    pub fake_provider: bool,
}

/// A mailbox to create for an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionMailbox {
    /// One per agent, reused by every retry: one mailbox per agent.
    pub request_id: Uuid,
    /// The agent's own account, the mailbox's owner.
    pub agent: MacroUserIdStr<'static>,
    /// The name mail from it shows.
    pub display_name: String,
    /// The address's local part we ask for.
    pub local_part: String,
}

/// Why email_service couldn't answer.
#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    /// No email provider is set up on this server.
    #[error("no email provider is configured")]
    NotConfigured,
    /// The provider refused the request.
    #[error("the email provider refused the request")]
    Rejected,
    /// email_service didn't answer.
    #[error("email service unavailable")]
    Unavailable(rootcause::Report),
}

/// What a release did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseOutcome {
    /// The mailbox is gone, or there was none.
    Released,
    /// email_service is still deleting it and finishes on its own.
    Releasing,
}

/// Agent mailboxes in email_service. Every call is idempotent.
pub trait AgentMailboxes: Send + Sync + 'static {
    /// Create the agent's mailbox, or answer with the one this request id
    /// already made. One bounded attempt: it may answer `Provisioning`.
    fn provision(
        &self,
        request: &ProvisionMailbox,
    ) -> impl Future<Output = Result<MailboxView, MailboxError>> + Send;

    /// The agent's mailbox, if it has one.
    fn status(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<MailboxView>, MailboxError>> + Send;

    /// Stop the agent's mailbox reading and sending; keep the mail and the
    /// address. No mailbox is success.
    fn pause(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;

    /// Delete the agent's mailbox and its mail; the address stops
    /// receiving. No mailbox is [`ReleaseOutcome::Released`].
    fn release(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<ReleaseOutcome, MailboxError>> + Send;
}

/// The agent's pointer to its mailbox and the last answer about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxRecord {
    /// The agent.
    pub agent: MacroUserIdStr<'static>,
    /// Its team.
    pub team_id: Uuid,
    /// The request id every provision of this agent's inbox reuses.
    pub request_id: Uuid,
    /// email_service's mailbox, once it answered with one.
    pub mailbox_id: Option<Uuid>,
    /// Last known address.
    pub address: Option<String>,
    /// Last known state.
    pub state: AgentInboxState,
    /// Last known failure.
    pub last_error: Option<AgentInboxFailure>,
    /// Whether a stand-in provider serves it.
    pub fake_provider: bool,
    /// When the record last changed.
    pub updated_at: DateTime<Utc>,
}

impl InboxRecord {
    /// What admins see.
    pub fn view(&self) -> AgentInbox {
        AgentInbox {
            address: self.address.clone(),
            state: self.state,
            failure: self.last_error,
            fake_provider: self.fake_provider,
        }
    }
}

/// The last thing learned about an agent's mailbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxUpdate {
    /// email_service's mailbox, if known.
    pub mailbox_id: Option<Uuid>,
    /// Its address, if known.
    pub address: Option<String>,
    /// Where it is.
    pub state: AgentInboxState,
    /// Why it failed.
    pub last_error: Option<AgentInboxFailure>,
    /// Whether a stand-in provider serves it.
    pub fake_provider: bool,
}

impl From<MailboxView> for InboxUpdate {
    fn from(view: MailboxView) -> Self {
        Self {
            mailbox_id: Some(view.mailbox_id),
            address: view.address,
            state: view.state,
            last_error: view.last_error,
            fake_provider: view.fake_provider,
        }
    }
}

/// Agents' inbox records (`team_agent_inboxes`).
pub trait AgentInboxRepository: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The agent's record, created in `state` with `request_id` if it has
    /// none; an existing record is returned unchanged, so its request id
    /// wins.
    fn reserve(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        request_id: Uuid,
        state: AgentInboxState,
    ) -> impl Future<Output = Result<InboxRecord, Self::Err>> + Send;

    /// The agent's record.
    fn get(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<InboxRecord>, Self::Err>> + Send;

    /// The team's records.
    fn list_for_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<InboxRecord>, Self::Err>> + Send;

    /// Store what was learned. A mailbox id once known is never cleared.
    fn update(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: &InboxUpdate,
    ) -> impl Future<Output = Result<InboxRecord, Self::Err>> + Send;

    /// [`Self::update`], unless the inbox is being wound down (pausing,
    /// paused, releasing or released) or its record is gone: then `None`,
    /// and nothing changes. Provisioning writes through this, so a removal that
    /// marked the record first always wins over a provision in flight.
    fn update_live(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: &InboxUpdate,
    ) -> impl Future<Output = Result<Option<InboxRecord>, Self::Err>> + Send;

    /// Records marked `pausing` or `releasing` that last changed before
    /// `changed_before`, in (`updated_at`, agent) order after `after`, at
    /// most `limit`.
    fn unsettled(
        &self,
        changed_before: DateTime<Utc>,
        after: Option<&SweepCursor>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<InboxRecord>, Self::Err>> + Send;
}

/// Where a sweep page ended: the next one starts after it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepCursor {
    /// The last record's `updated_at`.
    pub updated_at: DateTime<Utc>,
    /// The last record's agent.
    pub agent: String,
}

/// What one sweep round did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepRound {
    /// How many unsettled marks it found.
    pub found: usize,
    /// Where the next page starts, when this one was full; `None` when the
    /// sweep reached the end.
    pub next: Option<SweepCursor>,
}

/// Why an inbox request failed.
#[derive(Debug, thiserror::Error)]
pub enum InboxError {
    /// No email provider is set up on this server.
    #[error("email inboxes aren't available on this server")]
    NotConfigured,
    /// The agent has no inbox.
    #[error("the agent has no inbox")]
    NoInbox,
    /// email_service didn't answer.
    #[error("email inboxes are unavailable right now")]
    Unavailable(rootcause::Report),
    /// Storage failed.
    #[error("internal error: {0}")]
    Internal(rootcause::Report),
}

impl From<MailboxError> for InboxError {
    fn from(error: MailboxError) -> Self {
        match error {
            MailboxError::NotConfigured => Self::NotConfigured,
            MailboxError::Unavailable(report) => Self::Unavailable(report),
            rejected @ MailboxError::Rejected => {
                Self::Unavailable(rootcause::Report::new(rejected).into_dynamic())
            }
        }
    }
}

impl InboxError {
    fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}

/// An agent's inbox lifecycle, as the agent teammates service drives it.
pub trait AgentInboxes: Send + Sync + 'static {
    /// Create the agent's inbox, or retry the one it has. Idempotent: one
    /// inbox per agent however often it is called.
    fn provision(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        name: &str,
        local_part: &str,
    ) -> impl Future<Output = Result<AgentInbox, InboxError>> + Send;

    /// The agent's inbox, asking email_service again while it is being
    /// created.
    fn refresh(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AgentInbox, InboxError>> + Send;

    /// The team's agents' inboxes as last known, by agent id.
    fn for_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<HashMap<String, AgentInbox>, InboxError>> + Send;

    /// The agent was removed: stop its inbox, keep its mail. No inbox, or
    /// none configured, is success.
    fn pause(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), InboxError>> + Send;

    /// The agent's invite was taken back: delete its inbox. No inbox, or
    /// none configured, is success.
    fn release(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), InboxError>> + Send;
}

/// No inboxes: the server has no email provider wired.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoInboxes;

impl AgentInboxes for NoInboxes {
    async fn provision(
        &self,
        _team_id: Uuid,
        _agent: &MacroUserIdStr<'_>,
        _name: &str,
        _local_part: &str,
    ) -> Result<AgentInbox, InboxError> {
        Err(InboxError::NotConfigured)
    }

    async fn refresh(&self, _agent: &MacroUserIdStr<'_>) -> Result<AgentInbox, InboxError> {
        Err(InboxError::NoInbox)
    }

    async fn for_team(&self, _team_id: Uuid) -> Result<HashMap<String, AgentInbox>, InboxError> {
        Ok(HashMap::new())
    }

    async fn pause(&self, _team_id: Uuid, _agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        Ok(())
    }

    async fn release(&self, _team_id: Uuid, _agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        Ok(())
    }
}

/// [`AgentInboxes`] over the record store and email_service.
pub struct InboxService<Repository, Mailboxes> {
    repository: Repository,
    mailboxes: Mailboxes,
}

impl<Repository, Mailboxes> InboxService<Repository, Mailboxes> {
    /// Build the service.
    pub fn new(repository: Repository, mailboxes: Mailboxes) -> Self {
        Self {
            repository,
            mailboxes,
        }
    }
}

impl<Repository: AgentInboxRepository, Mailboxes: AgentMailboxes>
    InboxService<Repository, Mailboxes>
{
    async fn record(&self, agent: &MacroUserIdStr<'_>) -> Result<Option<InboxRecord>, InboxError> {
        self.repository
            .get(agent)
            .await
            .map_err(InboxError::internal)
    }

    async fn store(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: InboxUpdate,
    ) -> Result<InboxRecord, InboxError> {
        self.repository
            .update(agent, &update)
            .await
            .map_err(InboxError::internal)
    }

    /// Store a provisioning outcome unless a removal wound the inbox down
    /// meanwhile; then pause what email_service just made and answer with
    /// the wound-down inbox.
    async fn store_live(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: InboxUpdate,
    ) -> Result<AgentInbox, InboxError> {
        if let Some(stored) = self
            .repository
            .update_live(agent, &update)
            .await
            .map_err(InboxError::internal)?
        {
            return Ok(stored.view());
        }
        // A removal or a taken-back invite marked the record while
        // email_service was making the mailbox: finish what the mark asks for
        // now. If email_service doesn't answer, the mark stays and the inbox
        // sweep finishes it.
        let Some(record) = self.record(agent).await? else {
            return Ok(AgentInbox {
                address: update.address,
                state: AgentInboxState::Pausing,
                failure: None,
                fake_provider: update.fake_provider,
            });
        };
        let step = WindDown::for_mark(record.state);
        tracing::warn!(
            ?step,
            "the agent was removed while its inbox was being made"
        );
        let _ = self
            .wind_down(record.team_id, agent, step, Utc::now())
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "could not wind down a just-made inbox; the sweep retries");
            });
        Ok(self
            .record(agent)
            .await?
            .map_or(record.view(), |record| record.view()))
    }

    /// The agent's mailbox id: the stored one, else email_service's answer,
    /// since a mailbox it finished creating in the background may not be
    /// stored yet.
    async fn mailbox_id(
        &self,
        agent: &MacroUserIdStr<'_>,
        record: &InboxRecord,
    ) -> Result<Option<Uuid>, MailboxError> {
        if let Some(mailbox_id) = record.mailbox_id {
            return Ok(Some(mailbox_id));
        }
        Ok(self
            .mailboxes
            .status(agent)
            .await?
            .map(|view| view.mailbox_id))
    }

    /// Pause or release the agent's mailbox. The record is marked first
    /// (`pausing` or `releasing`, created if the agent has none), so a
    /// provision in flight sees it and finishes it; then email_service is
    /// told, and only its confirmation settles the mark (`paused`,
    /// `released`). A mark email_service hasn't confirmed stays for the
    /// inbox sweep, which retries it. No mailbox at all settles once
    /// [`SETTLE_WITHOUT_MAILBOX`] has passed since the mark, since a
    /// provision in flight could still make one until then.
    async fn wind_down(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        step: WindDown,
        now: DateTime<Utc>,
    ) -> Result<(), InboxError> {
        let (marked, settled) = match step {
            WindDown::Pause => (AgentInboxState::Pausing, AgentInboxState::Paused),
            WindDown::Release => (AgentInboxState::Releasing, AgentInboxState::Released),
        };
        let mark = Uuid::now_v7();
        let record = self
            .repository
            .reserve(agent, team_id, mark, marked)
            .await
            .map_err(InboxError::internal)?;
        let keep = |state| InboxUpdate {
            mailbox_id: record.mailbox_id,
            address: record.address.clone(),
            state,
            last_error: record.last_error,
            fake_provider: record.fake_provider,
        };
        // This call made the record: no provision ever reserved one, so
        // nothing exists at the provider and email_service isn't asked. A
        // removal never depends on email_service for an agent without an
        // inbox.
        if record.request_id == mark {
            self.store(agent, keep(settled)).await?;
            return Ok(());
        }
        let done_already = match step {
            // Already further down: a pause never undoes a release.
            WindDown::Pause => matches!(
                record.state,
                AgentInboxState::Paused | AgentInboxState::Releasing | AgentInboxState::Released
            ),
            WindDown::Release => record.state == AgentInboxState::Released,
        };
        if done_already {
            return Ok(());
        }
        let marked_at = if record.state == marked {
            record.updated_at
        } else {
            self.store(agent, keep(marked)).await?;
            now
        };
        let mailbox_id = match self.mailbox_id(agent, &record).await {
            Ok(Some(mailbox_id)) => mailbox_id,
            Ok(None) | Err(MailboxError::NotConfigured) => {
                if now - marked_at >= SETTLE_WITHOUT_MAILBOX {
                    self.store(agent, keep(settled)).await?;
                }
                return Ok(());
            }
            Err(error) => return Err(InboxError::from(error)),
        };
        let after = match step {
            WindDown::Pause => match self.mailboxes.pause(agent).await {
                Ok(()) | Err(MailboxError::NotConfigured) => AgentInboxState::Paused,
                Err(error) => return Err(InboxError::from(error)),
            },
            WindDown::Release => match self.mailboxes.release(agent).await {
                Ok(ReleaseOutcome::Released) | Err(MailboxError::NotConfigured) => {
                    AgentInboxState::Released
                }
                // Still deleting: the mark stays for the sweep to confirm.
                Ok(ReleaseOutcome::Releasing) => AgentInboxState::Releasing,
                Err(error) => return Err(InboxError::from(error)),
            },
        };
        self.store(
            agent,
            InboxUpdate {
                mailbox_id: Some(mailbox_id),
                last_error: None,
                ..keep(after)
            },
        )
        .await?;
        Ok(())
    }

    /// Finish wind-downs email_service hasn't confirmed: one page of at
    /// most `limit` records marked `pausing` or `releasing` for longer than
    /// [`SWEEP_AFTER`], after `after`. Marks it can't finish keep their place,
    /// so the caller pages on with [`SweepRound::next`] instead of meeting
    /// the same page again.
    #[tracing::instrument(
        name = "team_agents.inbox.sweep",
        skip_all,
        fields(found = tracing::field::Empty, failed = tracing::field::Empty),
        err
    )]
    pub async fn sweep_once(
        &self,
        now: DateTime<Utc>,
        after: Option<&SweepCursor>,
        limit: u32,
    ) -> Result<SweepRound, InboxError> {
        let records = self
            .repository
            .unsettled(now - SWEEP_AFTER, after, limit)
            .await
            .map_err(InboxError::internal)?;
        let mut failed = 0_usize;
        for record in &records {
            if let Err(error) = self
                .wind_down(
                    record.team_id,
                    &record.agent,
                    WindDown::for_mark(record.state),
                    now,
                )
                .await
            {
                failed += 1;
                tracing::warn!(
                    error = ?error,
                    agent_user_id = %agent_credentials::telemetry_id(record.agent.as_ref()),
                    "could not finish an inbox wind-down; a later round retries"
                );
            }
        }
        let span = tracing::Span::current();
        span.record("found", records.len());
        span.record("failed", failed);
        let full = u32::try_from(records.len()).is_ok_and(|found| found >= limit);
        Ok(SweepRound {
            found: records.len(),
            next: records.last().filter(|_| full).map(|last| SweepCursor {
                updated_at: last.updated_at,
                agent: last.agent.as_ref().to_owned(),
            }),
        })
    }

    /// The team is being deleted: release every agent's inbox. Each one is
    /// marked first, so whatever email_service doesn't confirm now the sweep
    /// finishes; an error means some weren't even marked, and deleting the
    /// team again retries them.
    #[tracing::instrument(
        name = "team_agents.inbox.release_team",
        skip_all,
        fields(team_id = %team_id, inboxes = tracing::field::Empty),
        err
    )]
    pub async fn release_team(&self, team_id: Uuid) -> Result<(), InboxError> {
        let records = self
            .repository
            .list_for_team(team_id)
            .await
            .map_err(InboxError::internal)?;
        tracing::Span::current().record("inboxes", records.len());
        let mut first_error = None;
        for record in records {
            if let Err(error) = self
                .wind_down(team_id, &record.agent, WindDown::Release, Utc::now())
                .await
            {
                tracing::warn!(error = ?error, "could not release an agent's inbox");
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

/// How long a wind-down that found no mailbox waits before it settles: a
/// provision in flight (one bounded attempt) may still make one until then.
pub const SETTLE_WITHOUT_MAILBOX: chrono::Duration = chrono::Duration::minutes(15);

/// How old an unconfirmed wind-down is before the sweep retries it, so it
/// doesn't race the request that is still making it.
pub const SWEEP_AFTER: chrono::Duration = chrono::Duration::minutes(1);

/// The most wind-downs one sweep round retries.
pub const SWEEP_BATCH: u32 = 100;

/// What winding an inbox down does.
#[derive(Debug, Clone, Copy)]
enum WindDown {
    /// Stop it, keep the mail.
    Pause,
    /// Delete it.
    Release,
}

impl WindDown {
    /// The wind-down a record's mark asks for.
    fn for_mark(state: AgentInboxState) -> Self {
        match state {
            AgentInboxState::Releasing | AgentInboxState::Released => Self::Release,
            AgentInboxState::Provisioning
            | AgentInboxState::Active
            | AgentInboxState::Failed
            | AgentInboxState::Pausing
            | AgentInboxState::Paused => Self::Pause,
        }
    }
}

fn failed(error: AgentInboxFailure, record: &InboxRecord) -> InboxUpdate {
    InboxUpdate {
        mailbox_id: record.mailbox_id,
        address: record.address.clone(),
        state: AgentInboxState::Failed,
        last_error: Some(error),
        fake_provider: record.fake_provider,
    }
}

impl<Repository: AgentInboxRepository, Mailboxes: AgentMailboxes> AgentInboxes
    for InboxService<Repository, Mailboxes>
{
    #[tracing::instrument(
        name = "team_agents.inbox.provision",
        skip_all,
        fields(team_id = %team_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref()), state = tracing::field::Empty, failure = tracing::field::Empty),
        err
    )]
    async fn provision(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        name: &str,
        local_part: &str,
    ) -> Result<AgentInbox, InboxError> {
        let record = self
            .repository
            .reserve(
                agent,
                team_id,
                Uuid::now_v7(),
                AgentInboxState::Provisioning,
            )
            .await
            .map_err(InboxError::internal)?;
        // A live inbox stays as it is; anything else asks again, with the
        // same request id, so a retry never makes a second mailbox.
        // A removed agent's inbox is never made again.
        if matches!(
            record.state,
            AgentInboxState::Active
                | AgentInboxState::Pausing
                | AgentInboxState::Paused
                | AgentInboxState::Releasing
                | AgentInboxState::Released
        ) {
            return Ok(record.view());
        }
        let request = ProvisionMailbox {
            request_id: record.request_id,
            agent: agent.clone().into_owned(),
            display_name: name.to_owned(),
            local_part: local_part.to_owned(),
        };
        let update = match self.mailboxes.provision(&request).await {
            Ok(view) => InboxUpdate::from(view),
            Err(MailboxError::NotConfigured) => {
                self.store_live(agent, failed(AgentInboxFailure::NotConfigured, &record))
                    .await?;
                return Err(InboxError::NotConfigured);
            }
            Err(MailboxError::Rejected) => failed(AgentInboxFailure::Rejected, &record),
            Err(MailboxError::Unavailable(error)) => {
                tracing::warn!(error = ?error, "email service didn't answer an inbox request");
                failed(AgentInboxFailure::Unavailable, &record)
            }
        };
        let stored = self.store_live(agent, update).await?;
        let span = tracing::Span::current();
        span.record("state", tracing::field::debug(stored.state));
        if let Some(failure) = stored.failure {
            span.record("failure", tracing::field::debug(failure));
        }
        Ok(stored)
    }

    #[tracing::instrument(
        name = "team_agents.inbox.refresh",
        skip_all,
        fields(agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn refresh(&self, agent: &MacroUserIdStr<'_>) -> Result<AgentInbox, InboxError> {
        let record = self.record(agent).await?.ok_or(InboxError::NoInbox)?;
        // Still being made, or a request whose answer was lost: email_service
        // may have it and finish it in the background.
        let unsettled = record.state == AgentInboxState::Provisioning
            || (record.state == AgentInboxState::Failed
                && record.last_error == Some(AgentInboxFailure::Unavailable));
        if !unsettled {
            return Ok(record.view());
        }
        match self.mailboxes.status(agent).await {
            Ok(Some(view)) => self.store_live(agent, view.into()).await,
            // Not made, or not answered yet; keep what we know.
            Ok(None) => Ok(record.view()),
            Err(MailboxError::NotConfigured) => {
                self.store_live(agent, failed(AgentInboxFailure::NotConfigured, &record))
                    .await
            }
            Err(MailboxError::Unavailable(error)) => {
                tracing::warn!(error = ?error, "email service didn't answer an inbox status");
                Ok(record.view())
            }
            Err(MailboxError::Rejected) => {
                tracing::warn!("email service refused an inbox status");
                Ok(record.view())
            }
        }
    }

    async fn for_team(&self, team_id: Uuid) -> Result<HashMap<String, AgentInbox>, InboxError> {
        Ok(self
            .repository
            .list_for_team(team_id)
            .await
            .map_err(InboxError::internal)?
            .into_iter()
            .map(|record| (record.agent.as_ref().to_owned(), record.view()))
            .collect())
    }

    #[tracing::instrument(
        name = "team_agents.inbox.pause",
        skip_all,
        fields(team_id = %team_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn pause(&self, team_id: Uuid, agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        self.wind_down(team_id, agent, WindDown::Pause, Utc::now())
            .await
    }

    #[tracing::instrument(
        name = "team_agents.inbox.release",
        skip_all,
        fields(team_id = %team_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn release(&self, team_id: Uuid, agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        self.wind_down(team_id, agent, WindDown::Release, Utc::now())
            .await
    }
}
