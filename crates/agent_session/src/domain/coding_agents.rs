//! Discover authorized personas and start their first session turn.
//! The internal coding-agents transport name is retained for rolling deployments.

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

/// Information used to choose a persona for a task.
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
    /// Stable mention handle, when supplied by the persona directory.
    pub handle: Option<String>,
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
    pub agent_id: Option<Uuid>,
    /// Exact display name or mention handle, resolved among the caller's agents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    /// Model override; omitted uses the selected persona's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Repository selection for runtimes that support it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    /// Starting branch of the selected repository.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_branch: Option<String>,
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
    #[error("invalid agent session command")]
    InvalidCommand,
    /// Empty tasks cannot start sessions.
    #[error("provide a non-empty task")]
    InvalidPrompt,
    /// Deleted, inaccessible, or disconnected persona.
    #[error(
        "this agent is unavailable; use ListAgents to choose an accessible agent or connect its runtime"
    )]
    Unavailable,
    /// Multiple accessible personas have the requested display name.
    #[error("multiple agents have that name; use ListAgents and select an agent by id")]
    AmbiguousAgent,
    /// The caller cannot use the requested capability.
    #[error("you do not have permission to start this agent")]
    Forbidden,
    /// A dependency failed without a safely attributable session.
    #[error("agent session operation failed")]
    OperationFailed,
    /// Transport failed after dispatch may already have admitted work.
    #[error("the agent session may already have started; do not retry this task automatically")]
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

/// Owner-authorized session delegation shared by tool and transport adapters.
pub trait CodingAgentService: Send + Sync + 'static {
    /// List the caller's configured, available personas.
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
                .filter(|candidate| candidate.available)
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
            if (command.agent_id.is_some() && command.agent_name.is_some())
                || command
                    .model
                    .as_ref()
                    .is_some_and(|model| model.trim().is_empty())
                || command
                    .agent_name
                    .as_ref()
                    .is_some_and(|name| name.trim().is_empty())
            {
                return Err(CodingAgentError::InvalidCommand);
            }
            // Re-read visibility at launch time. Discovery is never authority.
            // Model-only sessions need no provider-directory calls.
            let agent = if command.agent_id.is_none() && command.agent_name.is_none() {
                CodingAgent {
                    id: bot_id::MACRO_NEW_BOT_ID.as_uuid(),
                    name: "Macro".into(),
                    description: None,
                    instructions: String::new(),
                    harness: "macro-inmem".into(),
                    model: None,
                }
            } else {
                let candidates = self.directory.candidates(command.user_id.clone()).await?;
                let mut matches = candidates.into_iter().filter(|candidate| {
                    let agent = &candidate.agent;
                    command.agent_id == Some(agent.id)
                        || command.agent_name.as_ref().is_some_and(|name| {
                            let name = name.trim();
                            agent.name.eq_ignore_ascii_case(name)
                                || candidate.handle.as_ref().is_some_and(|handle| {
                                    handle.eq_ignore_ascii_case(
                                        name.strip_prefix('@').unwrap_or(name),
                                    )
                                })
                        })
                });
                let candidate = matches.next().ok_or(CodingAgentError::Unavailable)?;
                if matches.next().is_some() {
                    return Err(CodingAgentError::AmbiguousAgent);
                }
                if !candidate.available {
                    return Err(CodingAgentError::Unavailable);
                }
                candidate.agent
            };
            let session_id = AgentSessionId::new();
            let bot_id = BotId::new_from_uuid(agent.id);
            let failed = |reason| CodingAgentError::DispatchFailed {
                agent_session_id: session_id.as_uuid(),
                reason,
            };
            let prepared = self
                .sessions
                .prepare(PrepareRoutineSession {
                    repo_url: command.repo_url,
                    repo_branch: command.repo_branch,
                    selection: ValidateRoutineSession {
                        owner: command.user_id.clone(),
                        bot_id,
                        model: command.model,
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
