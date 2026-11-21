//! An agent teammate's own email inbox.
//!
//! The mailbox belongs to the agent's own Macro account; email_service
//! creates it at the provider and serves it ([`AgentMailboxes`]). This side
//! decides when an agent gets one, keeps one inbox per agent, and pauses or
//! releases it when the agent goes. The address lives only on the inbox,
//! never in the agent's account id.

use std::collections::HashMap;
use std::future::Future;

use futures::future::join_all;

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

    /// [`Self::update`] only while the record is still in `from`; `None`
    /// otherwise, and nothing changes. Settling a wind-down goes through
    /// this, so a pause finishing late never overwrites a release.
    fn settle(
        &self,
        agent: &MacroUserIdStr<'_>,
        from: AgentInboxState,
        update: &InboxUpdate,
    ) -> impl Future<Output = Result<Option<InboxRecord>, Self::Err>> + Send;

    /// Live records (`provisioning`, `active`, `failed`) that changed between
    /// `changed_after` and `changed_before` and whose agent no longer holds a
    /// team seat, at most `limit`: an inbox a provision made while its team
    /// was being deleted.
    fn seatless_live(
        &self,
        changed_after: DateTime<Utc>,
        changed_before: DateTime<Utc>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<InboxRecord>, Self::Err>> + Send;

    /// Claim at most `limit` records marked `pausing` or `releasing` whose
    /// next attempt is due at `now`: each claimed record's next attempt
    /// moves out by its backoff (a minute, doubling, at most an hour), so
    /// replicas split the work and a mark that keeps failing is tried less
    /// often, but never abandoned.
    fn claim_unsettled(
        &self,
        now: DateTime<Utc>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<InboxRecord>, Self::Err>> + Send;

    /// Like [`Self::reserve`] (created `provisioning`), but only while the
    /// agent holds a seat on `team_id`, checked in the same statement;
    /// `None` when it doesn't.
    fn reserve_seated(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        request_id: Uuid,
    ) -> impl Future<Output = Result<Option<InboxRecord>, Self::Err>> + Send;

    /// Every agent holding a seat on `team_id`.
    fn seated_agents(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Self::Err>> + Send;
}

/// What one sweep round did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepRound {
    /// How many marks it claimed.
    pub claimed: usize,
    /// How many marks and seatless inboxes it couldn't finish.
    pub failed: usize,
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
    /// The agent no longer holds a seat on its team.
    #[error("the agent is no longer on its team")]
    NotSeated,
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
        match self.mark(team_id, agent, step, now).await? {
            Marked::Done => Ok(()),
            Marked::Pending { record, marked_at } => {
                self.finish(agent, step, &record, marked_at, now).await
            }
        }
    }

    /// The first half of a wind-down: mark the record (creating it if the
    /// agent has none). Settles at once a record this call made, since no
    /// provision ever reserved one.
    async fn mark(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        step: WindDown,
        now: DateTime<Utc>,
    ) -> Result<Marked, InboxError> {
        let (marked, settled) = step.states();
        let mark = Uuid::now_v7();
        let record = self
            .repository
            .reserve(agent, team_id, mark, marked)
            .await
            .map_err(InboxError::internal)?;
        // This call made the record: nothing exists at the provider and
        // email_service isn't asked. A removal never depends on
        // email_service for an agent without an inbox.
        if record.request_id == mark {
            self.settle(agent, marked, keep(&record, settled)).await?;
            return Ok(Marked::Done);
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
            return Ok(Marked::Done);
        }
        if record.state == marked {
            let marked_at = record.updated_at;
            return Ok(Marked::Pending { record, marked_at });
        }
        let record = self.store(agent, keep(&record, marked)).await?;
        Ok(Marked::Pending {
            record,
            marked_at: now,
        })
    }

    /// The second half: tell email_service, and settle the mark only on its
    /// confirmation, and only while the record still carries this mark.
    async fn finish(
        &self,
        agent: &MacroUserIdStr<'_>,
        step: WindDown,
        record: &InboxRecord,
        marked_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<(), InboxError> {
        let (marked, settled) = step.states();
        // Ask first: a mailbox email_service already paused, released or is
        // releasing on its own needs no second call.
        let view = match self.mailboxes.status(agent).await {
            Ok(view) => view,
            Err(MailboxError::NotConfigured) => None,
            Err(error) => return Err(InboxError::from(error)),
        };
        let Some(view) = view else {
            // Gone after we knew it, or never made: done once nothing can
            // still make one.
            if record.mailbox_id.is_some() || now - marked_at >= SETTLE_WITHOUT_MAILBOX {
                self.settle(agent, marked, keep(record, settled)).await?;
            }
            return Ok(());
        };
        let after = match (step, view.state) {
            (WindDown::Pause, AgentInboxState::Paused)
            | (WindDown::Release, AgentInboxState::Released) => settled,
            // email_service is deleting it on its own retries.
            (_, AgentInboxState::Releasing) => return Ok(()),
            (WindDown::Pause, _) => match self.mailboxes.pause(agent).await {
                Ok(()) | Err(MailboxError::NotConfigured) => AgentInboxState::Paused,
                Err(error) => return Err(InboxError::from(error)),
            },
            (WindDown::Release, _) => match self.mailboxes.release(agent).await {
                Ok(ReleaseOutcome::Released) | Err(MailboxError::NotConfigured) => {
                    AgentInboxState::Released
                }
                // Still deleting: the mark stays for the sweep to confirm.
                Ok(ReleaseOutcome::Releasing) => return Ok(()),
                Err(error) => return Err(InboxError::from(error)),
            },
        };
        self.settle(
            agent,
            marked,
            InboxUpdate {
                mailbox_id: Some(view.mailbox_id),
                last_error: None,
                ..keep(record, after)
            },
        )
        .await?;
        Ok(())
    }

    async fn settle(
        &self,
        agent: &MacroUserIdStr<'_>,
        from: AgentInboxState,
        update: InboxUpdate,
    ) -> Result<(), InboxError> {
        self.repository
            .settle(agent, from, &update)
            .await
            .map(|_| ())
            .map_err(InboxError::internal)
    }

    /// Finish wind-downs email_service hasn't confirmed: claim at most
    /// `limit` marks that are due, and retry each. Also pauses live inboxes
    /// whose agent lost its seat without a mark ([`SEATLESS_WINDOW`]).
    #[tracing::instrument(
        name = "team_agents.inbox.sweep",
        skip_all,
        fields(
            claimed = tracing::field::Empty,
            failed = tracing::field::Empty,
            oldest_mark_age_s = tracing::field::Empty,
        ),
        err
    )]
    pub async fn sweep_once(
        &self,
        now: DateTime<Utc>,
        limit: u32,
    ) -> Result<SweepRound, InboxError> {
        let records = self
            .repository
            .claim_unsettled(now, limit)
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
                let agent_user_id = agent_credentials::telemetry_id(record.agent.as_ref());
                if now - record.updated_at >= STUCK_MARK_AFTER {
                    tracing::error!(
                        error = ?error,
                        agent_user_id = %agent_user_id,
                        mark_age_s = (now - record.updated_at).num_seconds(),
                        "an inbox wind-down has failed for over a day; it keeps being retried hourly"
                    );
                } else {
                    tracing::warn!(
                        error = ?error,
                        agent_user_id = %agent_user_id,
                        "could not finish an inbox wind-down; it is retried after its backoff"
                    );
                }
            }
        }
        let seatless = self
            .repository
            .seatless_live(now - SEATLESS_WINDOW, now - SWEEP_AFTER, limit)
            .await
            .map_err(InboxError::internal)?;
        for record in &seatless {
            tracing::warn!(
                agent_user_id = %agent_credentials::telemetry_id(record.agent.as_ref()),
                "an agent inbox outlived its seat; pausing it"
            );
            if let Err(error) = self
                .wind_down(record.team_id, &record.agent, WindDown::Pause, now)
                .await
            {
                failed += 1;
                tracing::warn!(error = ?error, "could not pause a seatless inbox; the sweep retries its mark");
            }
        }
        let span = tracing::Span::current();
        span.record("claimed", records.len());
        span.record("failed", failed);
        if let Some(oldest) = records.iter().map(|record| record.updated_at).min() {
            span.record("oldest_mark_age_s", (now - oldest).num_seconds());
        }
        Ok(SweepRound {
            claimed: records.len(),
            failed,
        })
    }

    /// The team is being deleted: pause every agent's inbox at once, so none
    /// keeps receiving mail; email_service releases paused mailboxes after
    /// its retention. Every one is marked first; an error means a mark
    /// couldn't be stored, and deleting the team again retries. Whatever
    /// email_service doesn't confirm now the sweep finishes.
    #[tracing::instrument(
        name = "team_agents.inbox.pause_team",
        skip_all,
        fields(team_id = %team_id, inboxes = tracing::field::Empty),
        err
    )]
    pub async fn pause_team(&self, team_id: Uuid) -> Result<(), InboxError> {
        // Every seated agent too, inbox or not: marking one without an inbox
        // records it paused, so a provision that starts after this never
        // makes one.
        let mut agents = self
            .repository
            .seated_agents(team_id)
            .await
            .map_err(InboxError::internal)?;
        for record in self
            .repository
            .list_for_team(team_id)
            .await
            .map_err(InboxError::internal)?
        {
            if !agents
                .iter()
                .any(|agent| agent.as_ref() == record.agent.as_ref())
            {
                agents.push(record.agent);
            }
        }
        tracing::Span::current().record("inboxes", agents.len());
        // Mark every inbox first: a failed mark fails the deletion, which
        // retries it. Telling email_service may fail without that: the marks
        // stay and the sweep finishes them.
        let mut pending = Vec::new();
        for agent in &agents {
            let now = Utc::now();
            if let Marked::Pending { record, marked_at } =
                self.mark(team_id, agent, WindDown::Pause, now).await?
            {
                pending.push((record, marked_at));
            }
        }
        // All at once: each call is bounded by the email_service adapter, so
        // the deletion waits for one call, not one per agent.
        let now = Utc::now();
        join_all(pending.iter().map(|(record, marked_at)| async move {
            let _ = self
                .finish(&record.agent, WindDown::Pause, record, *marked_at, now)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, "could not pause an agent's inbox now; the sweep retries");
                });
        }))
        .await;
        Ok(())
    }
}

/// How long a wind-down that found no mailbox waits before it settles: a
/// provision in flight (one bounded attempt) may still make one until then.
pub const SETTLE_WITHOUT_MAILBOX: chrono::Duration = chrono::Duration::minutes(15);

/// How old an unconfirmed wind-down is before the sweep retries it, so it
/// doesn't race the request that is still making it.
pub const SWEEP_AFTER: chrono::Duration = chrono::Duration::minutes(1);

/// How far back the sweep looks for live inboxes whose agent lost its seat
/// without a mark. Only a provision racing its team's deletion leaves one,
/// and it is written moments before the team row goes.
pub const SEATLESS_WINDOW: chrono::Duration = chrono::Duration::hours(1);

/// How old an unfinished mark is before each failed retry logs an error
/// rather than a warning: by then it needs someone to look.
pub const STUCK_MARK_AFTER: chrono::Duration = chrono::Duration::days(1);

/// The most wind-downs one sweep round retries.
pub const SWEEP_BATCH: u32 = 100;

/// What [`InboxService::mark`] left to do.
enum Marked {
    /// Nothing: settled, or already further down.
    Done,
    /// Tell email_service; the record carries the mark since `marked_at`.
    Pending {
        record: InboxRecord,
        marked_at: DateTime<Utc>,
    },
}

/// `record` as it is, in `state`.
fn keep(record: &InboxRecord, state: AgentInboxState) -> InboxUpdate {
    InboxUpdate {
        mailbox_id: record.mailbox_id,
        address: record.address.clone(),
        state,
        last_error: record.last_error,
        fake_provider: record.fake_provider,
    }
}

/// What winding an inbox down does.
#[derive(Debug, Clone, Copy)]
enum WindDown {
    /// Stop it, keep the mail.
    Pause,
    /// Delete it.
    Release,
}

impl WindDown {
    /// The mark this wind-down stores and the state that settles it.
    fn states(self) -> (AgentInboxState, AgentInboxState) {
        match self {
            Self::Pause => (AgentInboxState::Pausing, AgentInboxState::Paused),
            Self::Release => (AgentInboxState::Releasing, AgentInboxState::Released),
        }
    }

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
        // Only for an agent still on its team, checked as the record is made:
        // a team deletion that already listed the team's agents has marked
        // them, and one that finished took the seat.
        let record = self
            .repository
            .reserve_seated(agent, team_id, Uuid::now_v7())
            .await
            .map_err(InboxError::internal)?
            .ok_or(InboxError::NotSeated)?;
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
