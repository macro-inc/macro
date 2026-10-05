//! Discover authorized coding personas and start their first session turn.

use std::pin::Pin;

use agent_runtime_protocol::domain::action::AgentActionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::model::AgentSessionId;
use super::routines::{
    PrepareRoutineSession, PromptRoutineSession, RoutineSessionAction, RoutineSessionError,
    RoutineSessions, ValidateRoutineSession,
};

#[cfg(test)]
mod test;

/// Information used to choose a coding persona for a task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
pub struct CodingAgent {
    /// Persona id to pass to dispatch.
    pub id: Uuid,
    /// User-facing persona name.
    pub name: String,
    /// What the persona is intended to do.
    pub description: Option<String>,
    /// Saved guidance describing the persona's repositories and specialties.
    pub instructions: String,
    /// Runtime configured for the persona.
    pub harness: String,
    /// Persona's configured default model, absent when the provider chooses it.
    pub model: Option<String>,
}

/// Authorized persona facts supplied by the directory capability.
#[derive(Debug, Clone)]
pub struct CodingAgentCandidate {
    /// Information safe for the authorized caller to see.
    pub agent: CodingAgent,
    /// Whether the persona is configured for coding work.
    pub is_coding: bool,
    /// Whether its required runtime connection or provider credentials exist.
    pub available: bool,
}

/// The user's visible personas and their runtime configuration facts.
pub trait CodingAgentDirectory: Send + Sync + 'static {
    /// Enumerate only personas the caller may start, including supported system personas.
    fn candidates(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<CodingAgentCandidate>, CodingAgentError>> + Send;
}

/// A new task delegated with the authenticated user's authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchCodingAgentRequest {
    /// Verified tool caller; never supplied as an AI tool argument.
    pub user_id: MacroUserIdStr<'static>,
    /// Persona selected from the discovery result.
    pub agent_id: Uuid,
    /// Self-contained task and repository context for the coding agent.
    pub prompt: String,
}

/// A newly opened session whose first prompt has been accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
pub struct DispatchedCodingAgent {
    /// Session to show in a magic chip.
    pub agent_session_id: Uuid,
    /// Persona that owns the session's identity.
    pub agent_id: Uuid,
    /// Persona display name.
    pub agent_name: String,
}

/// Sanitized discovery and dispatch failures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum CodingAgentError {
    /// The internal command is malformed.
    #[error("invalid coding agent command")]
    InvalidCommand,
    /// Empty tasks cannot start sessions.
    #[error("provide a non-empty coding task")]
    InvalidPrompt,
    /// Deleted, inaccessible, non-coding, or disconnected persona.
    #[error("this coding agent is unavailable; list available coding agents again")]
    Unavailable,
    /// The caller cannot use the requested capability.
    #[error("you do not have permission to dispatch this coding agent")]
    Forbidden,
    /// A dependency failed without a safely attributable session.
    #[error("coding agent operation failed")]
    OperationFailed,
    /// Transport failed after dispatch may already have admitted work.
    #[error("the coding agent may already have started; do not retry this task automatically")]
    DispatchDeliveryUnknown,
    /// Opening or prompting may have had an effect; never automatically replay.
    #[error(
        "could not confirm dispatch for session {agent_session_id}: {reason}; do not retry this task automatically"
    )]
    DispatchFailed {
        /// Allocated session id, retained even if admission is uncertain.
        agent_session_id: Uuid,
        /// Closed session-domain failure reason.
        reason: RoutineSessionError,
    },
}

/// Owner-authorized coding delegation shared by tool and transport adapters.
pub trait CodingAgentService: Send + Sync + 'static {
    /// List the caller's configured, available coding personas.
    fn list(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<CodingAgent>, CodingAgentError>> + Send + '_>>;

    /// Reauthorize a persona, create a session, and admit its initial prompt once.
    fn dispatch(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>;
}

/// Delegation policy over the existing persona directory and session lifecycle.
pub struct CodingAgentServiceImpl<Directory, Sessions> {
    directory: Directory,
    sessions: Sessions,
}

impl<Directory, Sessions> CodingAgentServiceImpl<Directory, Sessions> {
    /// Compose persona visibility with the normal session preparation and control path.
    pub fn new(directory: Directory, sessions: Sessions) -> Self {
        Self {
            directory,
            sessions,
        }
    }
}

impl<Directory, Sessions> CodingAgentService for CodingAgentServiceImpl<Directory, Sessions>
where
    Directory: CodingAgentDirectory,
    Sessions: RoutineSessions,
{
    fn list(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<CodingAgent>, CodingAgentError>> + Send + '_>> {
        Box::pin(async move {
            Ok(self
                .directory
                .candidates(user_id)
                .await?
                .into_iter()
                .filter(|candidate| candidate.is_coding && candidate.available)
                .map(|candidate| candidate.agent)
                .collect())
        })
    }

    fn dispatch(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>
    {
        Box::pin(async move {
            if command.prompt.trim().is_empty() {
                return Err(CodingAgentError::InvalidPrompt);
            }
            // Re-read visibility and configuration at dispatch time. A saved tool
            // result is not authority to use a removed or reconfigured persona.
            let agent = self
                .list(command.user_id.clone())
                .await?
                .into_iter()
                .find(|agent| agent.id == command.agent_id)
                .ok_or(CodingAgentError::Unavailable)?;
            let session_id = AgentSessionId::new();
            let bot_id = BotId::new_from_uuid(agent.id);
            let failed = |reason| CodingAgentError::DispatchFailed {
                agent_session_id: session_id.as_uuid(),
                reason,
            };
            let prepared = self
                .sessions
                .prepare(PrepareRoutineSession {
                    selection: ValidateRoutineSession {
                        owner: command.user_id.clone(),
                        bot_id,
                        model: None,
                    },
                    session_id,
                })
                .await
                .map_err(failed)?;
            if prepared.session_id != session_id {
                return Err(failed(RoutineSessionError::SessionMismatch));
            }
            let action_id = AgentActionId::mint();
            let accepted = self
                .sessions
                .prompt(PromptRoutineSession {
                    action: RoutineSessionAction {
                        owner: command.user_id,
                        bot_id,
                        session_id,
                        action_id,
                    },
                    prompt: command.prompt,
                })
                .await
                .map_err(failed)?;
            if accepted.action_id != action_id {
                return Err(failed(RoutineSessionError::PromptDeliveryUnknown));
            }
            Ok(DispatchedCodingAgent {
                agent_session_id: session_id.as_uuid(),
                agent_id: agent.id,
                agent_name: agent.name,
            })
        })
    }
}
