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
    /// The provider asked us to slow down.
    Throttled,
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
    /// email_service didn't answer.
    #[error("email service unavailable")]
    Unavailable(rootcause::Report),
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
    /// receiving. No mailbox, or one email_service is still deleting, is
    /// success.
    fn release(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
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
}

impl From<MailboxView> for InboxUpdate {
    fn from(view: MailboxView) -> Self {
        Self {
            mailbox_id: Some(view.mailbox_id),
            address: view.address,
            state: view.state,
            last_error: view.last_error,
        }
    }
}

/// Agents' inbox records (`team_agent_inboxes`).
pub trait AgentInboxRepository: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The agent's record, created `provisioning` with `request_id` if it
    /// has none; an existing record is returned unchanged, so its request id
    /// wins.
    fn reserve(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        request_id: Uuid,
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
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), InboxError>> + Send;

    /// The agent's invite was taken back: delete its inbox. No inbox, or
    /// none configured, is success.
    fn release(
        &self,
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

    async fn pause(&self, _agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        Ok(())
    }

    async fn release(&self, _agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
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

    /// Pause or release the agent's mailbox and store the outcome; nothing
    /// to do without a record, a mailbox or a configured provider.
    async fn wind_down(
        &self,
        agent: &MacroUserIdStr<'_>,
        step: WindDown,
    ) -> Result<(), InboxError> {
        let Some(record) = self.record(agent).await? else {
            return Ok(());
        };
        let done_already = match step {
            WindDown::Pause => matches!(
                record.state,
                AgentInboxState::Paused | AgentInboxState::Releasing | AgentInboxState::Released
            ),
            WindDown::Release => record.state == AgentInboxState::Released,
        };
        if done_already {
            return Ok(());
        }
        let mailbox_id = match self.mailbox_id(agent, &record).await {
            Ok(Some(mailbox_id)) => mailbox_id,
            Ok(None) | Err(MailboxError::NotConfigured) => {
                // Nothing was created at the provider.
                self.store(
                    agent,
                    InboxUpdate {
                        mailbox_id: None,
                        address: record.address,
                        state: AgentInboxState::Released,
                        last_error: record.last_error,
                    },
                )
                .await?;
                return Ok(());
            }
            Err(MailboxError::Unavailable(error)) => return Err(InboxError::Unavailable(error)),
        };
        let (done, after) = match step {
            WindDown::Pause => (self.mailboxes.pause(agent).await, AgentInboxState::Paused),
            WindDown::Release => (
                self.mailboxes.release(agent).await,
                AgentInboxState::Released,
            ),
        };
        match done {
            Ok(()) | Err(MailboxError::NotConfigured) => {}
            Err(MailboxError::Unavailable(error)) => return Err(InboxError::Unavailable(error)),
        }
        self.store(
            agent,
            InboxUpdate {
                mailbox_id: Some(mailbox_id),
                address: record.address,
                state: after,
                last_error: None,
            },
        )
        .await?;
        Ok(())
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

fn failed(error: AgentInboxFailure, record: &InboxRecord) -> InboxUpdate {
    InboxUpdate {
        mailbox_id: record.mailbox_id,
        address: record.address.clone(),
        state: AgentInboxState::Failed,
        last_error: Some(error),
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
            .reserve(agent, team_id, Uuid::now_v7())
            .await
            .map_err(InboxError::internal)?;
        // A live inbox stays as it is; anything else asks again, with the
        // same request id, so a retry never makes a second mailbox.
        if matches!(
            record.state,
            AgentInboxState::Active | AgentInboxState::Paused | AgentInboxState::Releasing
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
                self.store(agent, failed(AgentInboxFailure::NotConfigured, &record))
                    .await?;
                return Err(InboxError::NotConfigured);
            }
            Err(MailboxError::Unavailable(error)) => {
                tracing::warn!(error = ?error, "email service didn't answer an inbox request");
                failed(AgentInboxFailure::Unavailable, &record)
            }
        };
        let stored = self.store(agent, update).await?;
        let span = tracing::Span::current();
        span.record("state", tracing::field::debug(stored.state));
        if let Some(failure) = stored.last_error {
            span.record("failure", tracing::field::debug(failure));
        }
        Ok(stored.view())
    }

    #[tracing::instrument(
        name = "team_agents.inbox.refresh",
        skip_all,
        fields(agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn refresh(&self, agent: &MacroUserIdStr<'_>) -> Result<AgentInbox, InboxError> {
        let record = self.record(agent).await?.ok_or(InboxError::NoInbox)?;
        if record.state != AgentInboxState::Provisioning {
            return Ok(record.view());
        }
        match self.mailboxes.status(agent).await {
            Ok(Some(view)) => Ok(self.store(agent, view.into()).await?.view()),
            // Not answered yet; keep what we know.
            Ok(None) => Ok(record.view()),
            Err(MailboxError::NotConfigured) => Ok(self
                .store(agent, failed(AgentInboxFailure::NotConfigured, &record))
                .await?
                .view()),
            Err(MailboxError::Unavailable(error)) => {
                tracing::warn!(error = ?error, "email service didn't answer an inbox status");
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
        fields(agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn pause(&self, agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        self.wind_down(agent, WindDown::Pause).await
    }

    #[tracing::instrument(
        name = "team_agents.inbox.release",
        skip_all,
        fields(agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn release(&self, agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        self.wind_down(agent, WindDown::Release).await
    }
}
