//! An agent's conversation in a channel: the channel holds the transcript,
//! and the conversation's sessions hold the agent's context.

use agent_session::domain::agent_conversation::{
    AgentConversation, AgentConversationRepo, ConversationSession,
};
use agent_session::domain::{
    error::{AgentSessionError, Result as SessionResult},
    model::AgentSessionId,
};
use bot_id::BotId;
use bots::domain::{
    models::BotProfile,
    ports::{AgentDmEligibility, BotError, BotRepo},
};
use channels::domain::channel_agents::{ChannelAgent, ChannelAgentKind, ChannelAgentRepo};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// Runtime policy for agent conversations, rechecked when a queued prompt
/// dispatches.
#[async_trait::async_trait]
pub trait ConversationPolicy: Send + Sync + 'static {
    /// The current session of an already validated conversation, for new admissions.
    async fn current_context(&self, session_id: AgentSessionId) -> SessionResult<AgentSessionId>;
    /// Validate who may prompt the conversation, for durable admission. Current
    /// persona eligibility is checked at execution, so revoked work can be
    /// recorded as failed instead of becoming an unacknowledgeable broker event.
    async fn validate_binding(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool>;
    /// Recheck the prompter and the persona, including team access changes.
    /// Returns false when this session belongs to no conversation.
    async fn authorize_prompt(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool>;
    /// Immutable conversation provenance, used to choose notification behavior.
    async fn is_conversation_session(&self, session_id: AgentSessionId) -> SessionResult<bool>;
}

#[cfg(test)]
mod test;

/// A conversation as the person it is with sees it.
pub struct ConversationOverview {
    /// Channel containing the visible transcript.
    pub channel_id: Uuid,
    /// Historical persona identity, retained after deletion.
    pub persona: BotProfile,
    /// Whether the caller may still prompt this persona.
    pub available: bool,
    /// The persona has edits that a new session would adopt.
    pub settings_changed: bool,
    /// The sessions the conversation has run on, oldest first.
    pub sessions: Vec<ConversationSession>,
    /// Durable execution status of the messages the persona answered.
    pub turns: Vec<super::conversation_turns::ConversationTurnStatus>,
}

/// Metadata lookup failures. Someone else's conversation is concealed as not found.
#[derive(Debug, thiserror::Error)]
pub enum ConversationError {
    /// No conversation the caller may see is at this id.
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

/// Queries and controls for the person a conversation is with.
pub trait AgentConversations: Send + Sync + 'static {
    /// Adopt current persona settings in a new session while keeping history.
    /// The expected session makes double submissions and stale tabs safe.
    fn start_fresh(
        &self,
        caller: MacroUserIdStr<'static>,
        conversation: AgentConversation,
        expected: AgentSessionId,
    ) -> impl Future<Output = Result<(), ConversationError>> + Send;
    /// The conversations in a channel the caller may see, without starting a
    /// session or requiring current persona eligibility. Ordinary channels and
    /// other people's conversations have none.
    fn list(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ConversationOverview>, ConversationError>> + Send;
    /// Explicitly retry a failed attempt in the current session under current access.
    fn retry(
        &self,
        caller: MacroUserIdStr<'static>,
        conversation: AgentConversation,
        source: Uuid,
        expected: agent_runtime_protocol::domain::action::AgentActionId,
    ) -> impl Future<Output = Result<(), ConversationError>> + Send;
}

/// Coordinates the channel, persona, and session domain ports.
pub struct AgentConversationsService<C, P, B, S> {
    channels: C,
    eligibility: P,
    bots: B,
    sessions: S,
    turns: Option<std::sync::Arc<dyn super::conversation_turns::ConversationTurnStore>>,
}

impl<C, P, B, S> AgentConversationsService<C, P, B, S> {
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

    /// Include durable turn status in the conversation overview.
    pub fn with_turns(
        mut self,
        turns: std::sync::Arc<dyn super::conversation_turns::ConversationTurnStore>,
    ) -> Self {
        self.turns = Some(turns);
        self
    }
}

/// Whether `caller` is the person a conversation is with. Only a direct
/// conversation has one today; a member of a shared channel has no rule yet,
/// so nobody may prompt it or see its controls.
fn is_with(agent: &ChannelAgent, caller: &MacroUserIdStr<'static>) -> bool {
    match &agent.kind {
        ChannelAgentKind::Direct { user_id } => user_id == caller,
        ChannelAgentKind::Member => false,
    }
}

#[async_trait::async_trait]
impl<C: ChannelAgentRepo, P: AgentDmEligibility, B: BotRepo, S: AgentConversationRepo>
    ConversationPolicy for AgentConversationsService<C, P, B, S>
{
    async fn current_context(&self, session_id: AgentSessionId) -> SessionResult<AgentSessionId> {
        let conversation = self
            .sessions
            .conversation_for_session(session_id)
            .await?
            .ok_or(AgentSessionError::Forbidden)?;
        self.sessions
            .current(conversation)
            .await?
            .ok_or(AgentSessionError::Forbidden)
    }

    async fn validate_binding(
        &self,
        session_id: AgentSessionId,
        bot_id: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> SessionResult<bool> {
        let Some(conversation) = self.sessions.conversation_for_session(session_id).await? else {
            return Ok(false);
        };
        if conversation.bot_id != bot_id {
            return Err(AgentSessionError::Forbidden);
        }
        let agent = self
            .channels
            .find(conversation.channel_id, conversation.bot_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(AgentSessionError::Forbidden)?;
        match actor {
            Some(actor) if is_with(&agent, actor) => Ok(true),
            _ => Err(AgentSessionError::Forbidden),
        }
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
        let conversation = self
            .sessions
            .conversation_for_session(session_id)
            .await?
            .ok_or(AgentSessionError::Forbidden)?;
        if self.sessions.current(conversation).await? != Some(session_id) {
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

    async fn is_conversation_session(&self, session_id: AgentSessionId) -> SessionResult<bool> {
        Ok(self
            .sessions
            .conversation_for_session(session_id)
            .await?
            .is_some())
    }
}

impl<C: ChannelAgentRepo, P: AgentDmEligibility, B: BotRepo, S: AgentConversationRepo>
    AgentConversationsService<C, P, B, S>
{
    /// The agent of a conversation the caller is part of. Team ownership of a
    /// persona never grants access to someone else's conversation.
    async fn joined(
        &self,
        caller: &MacroUserIdStr<'static>,
        conversation: AgentConversation,
    ) -> Result<ChannelAgent, ConversationError> {
        self.channels
            .find(conversation.channel_id, conversation.bot_id)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
            .filter(|agent| is_with(agent, caller))
            .ok_or(ConversationError::NotFound)
    }

    async fn overview(
        &self,
        caller: MacroUserIdStr<'static>,
        agent: ChannelAgent,
    ) -> Result<ConversationOverview, ConversationError> {
        let conversation = AgentConversation {
            channel_id: agent.channel_id,
            bot_id: agent.bot_id,
        };
        let available = match self
            .eligibility
            .authorize_agent_dm(caller, agent.bot_id)
            .await
        {
            Ok(()) => true,
            Err(BotError::Unauthorized | BotError::NotFound(_)) => false,
            Err(error) => return Err(ConversationError::Unavailable(error.into())),
        };
        let persona = self
            .bots
            .get_bot_profiles(&[agent.bot_id])
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
            .remove(&agent.bot_id)
            .unwrap_or(BotProfile {
                id: agent.bot_id,
                name: "Unavailable agent".to_owned(),
                avatar_url: None,
            });
        let sessions = self
            .sessions
            .sessions(conversation)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?;
        let mut settings_changed = false;
        if available
            && let Some(current) = sessions.iter().find(|session| session.is_current)
            && let Some(store) = &self.turns
            && let Some(settings) = store
                .settings(current.session_id)
                .await
                .map_err(|error| ConversationError::Unavailable(error.into()))?
            && let Some(persona_agent) = self
                .bots
                .get_agent(agent.bot_id)
                .await
                .map_err(|error| ConversationError::Unavailable(error.into()))?
        {
            let runtime = settings.runtime;
            let permissions_changed = match settings.permissions {
                super::model::PermissionPolicyConfig::Persona {
                    auto_accept_permissions,
                    ..
                } => auto_accept_permissions != persona_agent.auto_accept_permissions,
                _ => false,
            };
            settings_changed = runtime.instructions != persona_agent.instructions
                || runtime.model != persona_agent.default_model
                || runtime.harness != persona_agent.harness
                || runtime.mcp_servers != persona_agent.mcp
                || permissions_changed;
        }
        Ok(ConversationOverview {
            channel_id: agent.channel_id,
            persona,
            available,
            settings_changed,
            sessions,
            turns: match &self.turns {
                Some(turns) => turns
                    .for_conversation(agent.channel_id, agent.bot_id)
                    .await
                    .map_err(|error| ConversationError::Unavailable(error.into()))?,
                None => Vec::new(),
            },
        })
    }
}

impl<C: ChannelAgentRepo, P: AgentDmEligibility, B: BotRepo, S: AgentConversationRepo>
    AgentConversations for AgentConversationsService<C, P, B, S>
{
    async fn start_fresh(
        &self,
        caller: MacroUserIdStr<'static>,
        conversation: AgentConversation,
        expected: AgentSessionId,
    ) -> Result<(), ConversationError> {
        let agent = self.joined(&caller, conversation).await?;
        self.eligibility
            .authorize_agent_dm(caller, agent.bot_id)
            .await
            .map_err(|error| match error {
                BotError::Unauthorized | BotError::NotFound(_) => ConversationError::NotRetryable,
                error => ConversationError::Unavailable(error.into()),
            })?;
        let store = self.turns.as_ref().ok_or(ConversationError::ContextBusy)?;
        let _lease = store
            .claim_context(expected)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
            .ok_or(ConversationError::ContextBusy)?;
        if self
            .sessions
            .current(conversation)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
            != Some(expected)
        {
            return Err(ConversationError::ContextBusy);
        }
        let turns = store
            .for_conversation(conversation.channel_id, conversation.bot_id)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?;
        if turns.iter().any(|turn| {
            turn.session_id == expected
                && turn.state == super::conversation_turns::ConversationTurnState::Running
        }) {
            return Err(ConversationError::ContextBusy);
        }
        self.sessions
            .start_fresh(conversation)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?;
        // Dispatch uses the same lease; no queued action can cross this boundary.
        // If cancellation fails, dispatch authorization still rejects the old session.
        store
            .cancel_queued(expected)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?;
        tracing::info!(
            channel_id = %conversation.channel_id,
            bot_id = %conversation.bot_id,
            previous_session = %expected,
            "agent conversation context reset"
        );
        Ok(())
    }

    async fn retry(
        &self,
        caller: MacroUserIdStr<'static>,
        conversation: AgentConversation,
        source: Uuid,
        expected: agent_runtime_protocol::domain::action::AgentActionId,
    ) -> Result<(), ConversationError> {
        let agent = self.joined(&caller, conversation).await?;
        let overview = self.overview(caller, agent).await?;
        if !overview.available {
            return Err(ConversationError::NotRetryable);
        }
        let current = overview
            .sessions
            .iter()
            .find(|session| session.is_current)
            .map(|session| session.session_id);
        let record = overview
            .turns
            .iter()
            .find(|turn| turn.source_message_id == source)
            .ok_or(ConversationError::NotFound)?;
        if Some(record.session_id) != current || record.action_id != expected {
            return Err(ConversationError::NotRetryable);
        }
        let store = self.turns.as_ref().ok_or(ConversationError::NotRetryable)?;
        let _lease = store
            .claim_context(record.session_id)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
            .ok_or(ConversationError::NotRetryable)?;
        if self
            .sessions
            .current(conversation)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
            != Some(record.session_id)
        {
            return Err(ConversationError::NotRetryable);
        }
        if !store
            .retry(source, conversation.bot_id, expected)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?
        {
            return Err(ConversationError::NotRetryable);
        }
        Ok(())
    }

    async fn list(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<Vec<ConversationOverview>, ConversationError> {
        let agents = self
            .channels
            .agents_in(channel_id)
            .await
            .map_err(|error| ConversationError::Unavailable(error.into()))?;
        let mut overviews = Vec::new();
        // Check membership before loading profiles, eligibility, or session
        // identities, so someone else's conversation reveals nothing.
        for agent in agents.into_iter().filter(|agent| is_with(agent, &caller)) {
            overviews.push(self.overview(caller.clone(), agent).await?);
        }
        Ok(overviews)
    }
}
