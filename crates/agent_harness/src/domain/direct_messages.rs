//! A channel owns the private conversation; sessions own its context segments.

use agent_session::domain::agent_dm::{AgentDmConversationRepo, AgentDmSegment};
use agent_session::domain::{
    error::{AgentSessionError, Result as SessionResult},
    model::AgentSessionId,
};
use bot_id::BotId;
use bots::domain::{
    models::BotProfile,
    ports::{AgentDmEligibility, BotError, BotRepo},
};
use channels::domain::agent_dm::AgentDmRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// Runtime policy for persistent DMs, rechecked when a queued prompt dispatches.
#[async_trait::async_trait]
pub trait AgentDmExecutionPolicy: Send + Sync + 'static {
    /// The current segment of an already validated conversation, for new admissions.
    async fn current_context(&self, session_id: AgentSessionId) -> SessionResult<AgentSessionId>;
    /// Validate immutable conversation ownership for durable admission. Current
    /// persona eligibility is checked at execution, so revoked work can be
    /// recorded as failed instead of becoming an unacknowledgeable broker event.
    async fn validate_binding(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool>;
    /// Recheck the exact owner and persona, including team access changes.
    /// Returns false when this session does not belong to an agent DM.
    async fn authorize_prompt(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool>;
    /// Immutable conversation provenance, used to choose notification behavior.
    async fn is_dm_session(&self, session_id: AgentSessionId) -> SessionResult<bool>;
}

#[cfg(test)]
mod test;

/// Read model for the owner of a private agent conversation.
pub struct AgentDmConversation {
    /// Channel containing the visible transcript.
    pub channel_id: Uuid,
    /// Historical persona identity, retained after deletion.
    pub persona: BotProfile,
    /// Whether the caller may still invoke this persona.
    pub available: bool,
    /// The persona has edits that can be adopted by starting a new context.
    pub settings_changed: bool,
    /// Context boundaries, oldest first.
    pub segments: Vec<AgentDmSegment>,
    /// Durable execution status of messages in this private transcript.
    pub turns: Vec<super::dm_turns::DmTurnStatus>,
}

/// Metadata lookup failures. A foreign conversation is concealed as not found.
#[derive(Debug, thiserror::Error)]
pub enum AgentDmError {
    /// No DM belongs to the caller at this id.
    #[error("conversation not found")]
    NotFound,
    /// This attempt cannot be retried in the current conversation state.
    #[error("this message cannot be retried now")]
    NotRetryable,
    /// A stale reset request or a running turn prevents changing context.
    #[error("stop the current turn before starting fresh")]
    ContextBusy,
    /// An owning domain could not read its durable state.
    #[error("could not load the conversation")]
    Unavailable(#[source] anyhow::Error),
}

/// Owner-only conversation queries. Ordinary channels return no DM metadata.
pub trait AgentDmConversations: Send + Sync + 'static {
    /// Adopt current persona settings in a new context while retaining history.
    /// The expected segment makes double submissions and stale tabs safe.
    fn start_fresh(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        expected: AgentSessionId,
    ) -> impl Future<Output = Result<(), AgentDmError>> + Send;
    /// Read without starting a session or requiring current persona eligibility.
    fn get(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<AgentDmConversation>, AgentDmError>> + Send;
    /// Explicitly retry a failed current-segment attempt under current access.
    fn retry(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        source: Uuid,
        expected: agent_runtime_protocol::domain::action::AgentActionId,
    ) -> impl Future<Output = Result<(), AgentDmError>> + Send;
}

/// Coordinates the channel, persona, and session domain ports.
pub struct AgentDmConversationsService<C, P, B, S> {
    channels: C,
    eligibility: P,
    bots: B,
    sessions: S,
    turns: Option<std::sync::Arc<dyn super::dm_turns::DmTurnStore>>,
}

impl<C, P, B, S> AgentDmConversationsService<C, P, B, S> {
    /// Compose owning-domain capabilities; this service owns the read policy.
    pub fn new(channels: C, eligibility: P, bots: B, sessions: S) -> Self {
        Self {
            channels,
            eligibility,
            bots,
            sessions,
            turns: None,
        }
    }

    /// Include durable turn status in the owner-only conversation projection.
    pub fn with_turns(mut self, turns: std::sync::Arc<dyn super::dm_turns::DmTurnStore>) -> Self {
        self.turns = Some(turns);
        self
    }
}

#[async_trait::async_trait]
impl<C: AgentDmRepo, P: AgentDmEligibility, B: BotRepo, S: AgentDmConversationRepo>
    AgentDmExecutionPolicy for AgentDmConversationsService<C, P, B, S>
{
    async fn current_context(&self, session_id: AgentSessionId) -> SessionResult<AgentSessionId> {
        let channel = self
            .sessions
            .channel_for_session(session_id)
            .await?
            .ok_or(AgentSessionError::Forbidden)?;
        self.sessions
            .current(channel)
            .await?
            .ok_or(AgentSessionError::Forbidden)
    }

    async fn validate_binding(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool> {
        let Some(channel_id) = self.sessions.channel_for_session(session_id).await? else {
            return Ok(false);
        };
        let binding = self
            .channels
            .find(channel_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(AgentSessionError::Forbidden)?;
        if binding.bot_id != bot_id || actor != Some(&binding.user_id) {
            return Err(AgentSessionError::Forbidden);
        }
        Ok(true)
    }

    async fn authorize_prompt(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool> {
        if !self.validate_binding(session_id, bot_id, actor).await? {
            return Ok(false);
        }
        let channel = self
            .sessions
            .channel_for_session(session_id)
            .await?
            .ok_or(AgentSessionError::Forbidden)?;
        if self.sessions.current(channel).await? != Some(session_id) {
            return Err(AgentSessionError::Forbidden);
        }
        match self
            .eligibility
            .authorize_agent_dm(actor.cloned().ok_or(AgentSessionError::Forbidden)?, bot_id)
            .await
        {
            Ok(()) => Ok(true),
            Err(BotError::Unauthorized | BotError::NotFound(_)) => {
                Err(AgentSessionError::Forbidden)
            }
            Err(error) => Err(AgentSessionError::Unknown(error.into())),
        }
    }

    async fn is_dm_session(&self, session_id: AgentSessionId) -> SessionResult<bool> {
        Ok(self
            .sessions
            .channel_for_session(session_id)
            .await?
            .is_some())
    }
}

impl<C: AgentDmRepo, P: AgentDmEligibility, B: BotRepo, S: AgentDmConversationRepo>
    AgentDmConversations for AgentDmConversationsService<C, P, B, S>
{
    async fn start_fresh(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        expected: AgentSessionId,
    ) -> Result<(), AgentDmError> {
        let binding = self
            .channels
            .find(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
            .filter(|binding| binding.user_id == caller)
            .ok_or(AgentDmError::NotFound)?;
        self.eligibility
            .authorize_agent_dm(caller, binding.bot_id)
            .await
            .map_err(|error| match error {
                BotError::Unauthorized | BotError::NotFound(_) => AgentDmError::NotRetryable,
                error => AgentDmError::Unavailable(error.into()),
            })?;
        let store = self.turns.as_ref().ok_or(AgentDmError::ContextBusy)?;
        let _lease = store
            .claim_context(expected)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
            .ok_or(AgentDmError::ContextBusy)?;
        if self
            .sessions
            .current(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
            != Some(expected)
        {
            return Err(AgentDmError::ContextBusy);
        }
        let turns = store
            .for_channel(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?;
        if turns.iter().any(|turn| {
            turn.session_id == expected && turn.state == super::dm_turns::DmTurnState::Running
        }) {
            return Err(AgentDmError::ContextBusy);
        }
        self.sessions
            .start_fresh(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?;
        // Dispatch uses the same lease; no queued action can cross this boundary.
        // If cancellation fails, dispatch authorization still rejects the old segment.
        store
            .cancel_queued(expected)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?;
        tracing::info!(%channel_id, previous_session = %expected, "agent DM context reset");
        Ok(())
    }

    async fn retry(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
        source: Uuid,
        expected: agent_runtime_protocol::domain::action::AgentActionId,
    ) -> Result<(), AgentDmError> {
        let conversation = self
            .get(caller, channel_id)
            .await?
            .ok_or(AgentDmError::NotFound)?;
        if !conversation.available {
            return Err(AgentDmError::NotRetryable);
        }
        let current = conversation
            .segments
            .iter()
            .find(|segment| segment.is_current)
            .map(|segment| segment.session_id);
        let record = conversation
            .turns
            .iter()
            .find(|turn| turn.source_message_id == source)
            .ok_or(AgentDmError::NotFound)?;
        if Some(record.session_id) != current || record.action_id != expected {
            return Err(AgentDmError::NotRetryable);
        }
        let store = self.turns.as_ref().ok_or(AgentDmError::NotRetryable)?;
        let _lease = store
            .claim_context(record.session_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
            .ok_or(AgentDmError::NotRetryable)?;
        if self
            .sessions
            .current(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
            != Some(record.session_id)
        {
            return Err(AgentDmError::NotRetryable);
        }
        if !store
            .retry(source, expected)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
        {
            return Err(AgentDmError::NotRetryable);
        }
        Ok(())
    }

    async fn get(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<Option<AgentDmConversation>, AgentDmError> {
        let Some(binding) = self
            .channels
            .find(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
        else {
            return Ok(None);
        };
        // Team ownership of a persona never grants access to someone's DM.
        // Check before loading profiles, eligibility, or session identities.
        if binding.user_id != caller {
            return Err(AgentDmError::NotFound);
        }
        let available = match self
            .eligibility
            .authorize_agent_dm(caller, binding.bot_id)
            .await
        {
            Ok(()) => true,
            Err(BotError::Unauthorized | BotError::NotFound(_)) => false,
            Err(error) => return Err(AgentDmError::Unavailable(error.into())),
        };
        let persona = self
            .bots
            .get_bot_profiles(&[binding.bot_id])
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?
            .remove(&binding.bot_id)
            .unwrap_or(BotProfile {
                id: binding.bot_id,
                name: "Unavailable agent".to_owned(),
                avatar_url: None,
            });
        let segments = self
            .sessions
            .segments(channel_id)
            .await
            .map_err(|error| AgentDmError::Unavailable(error.into()))?;
        let mut settings_changed = false;
        if available
            && let Some(current) = segments.iter().find(|segment| segment.is_current)
            && let Some(store) = &self.turns
            && let Some(settings) = store
                .settings(current.session_id)
                .await
                .map_err(|error| AgentDmError::Unavailable(error.into()))?
            && let Some(agent) = self
                .bots
                .get_agent(binding.bot_id)
                .await
                .map_err(|error| AgentDmError::Unavailable(error.into()))?
        {
            let runtime = settings.runtime;
            let permissions_changed = match settings.permissions {
                super::model::PermissionPolicyConfig::Persona {
                    auto_accept_permissions,
                    ..
                } => auto_accept_permissions != agent.auto_accept_permissions,
                _ => false,
            };
            settings_changed = runtime.instructions != agent.instructions
                || runtime.model != agent.default_model
                || runtime.harness != agent.harness
                || runtime.mcp_servers != agent.mcp
                || permissions_changed;
        }
        Ok(Some(AgentDmConversation {
            channel_id,
            persona,
            available,
            settings_changed,
            segments,
            turns: match &self.turns {
                Some(turns) => turns
                    .for_channel(channel_id)
                    .await
                    .map_err(|error| AgentDmError::Unavailable(error.into()))?,
                None => Vec::new(),
            },
        }))
    }
}
