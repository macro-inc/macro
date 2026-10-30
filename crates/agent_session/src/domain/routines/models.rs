//! Transport-independent routine commands and sanitized results.

use agent_runtime_protocol::domain::action::AgentActionId;
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::model::{AgentMcpServer, AgentSessionId, SessionSource, SessionVisibility};

/// A persona selected by a routine's validated user owner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidateRoutineSession {
    /// User whose authority and credentials execution spends.
    pub owner: MacroUserIdStr<'static>,
    /// Selected persona, not a runtime allowlist entry.
    pub bot_id: BotId,
    /// Omitted means the persona's current default at preparation time.
    pub model: Option<String>,
    /// Apps the routine itself requires. The owner must have each one
    /// connected; the session gets them on top of the persona's own servers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<AgentMcpServer>,
}

/// An authorized selection. Validation does not establish runtime availability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidatedRoutineSession {
    /// Whether this deployment provisions the runtime.
    pub managed: bool,
}

/// Create a fresh session without delivering any prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepareRoutineSession {
    /// Selection reauthorized at execution time.
    pub selection: ValidateRoutineSession,
    /// Caller-generated UUIDv7, allocated before awaiting preparation.
    pub session_id: AgentSessionId,
    /// Who is starting the session: a routine for the scheduler, the user
    /// for a coding agent dispatched on their behalf. Older schedulers omit it.
    #[serde(default)]
    pub source: SessionSource,
    /// Whether a routine's run is listed, from the routine's setting. Older
    /// schedulers omit it along with `source`.
    #[serde(default)]
    pub visibility: SessionVisibility,
}

/// A verified, persisted session ready for its first prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreparedRoutineSession {
    /// The caller's requested session id.
    pub session_id: AgentSessionId,
}

/// Identity checked on every subsequent operation; an id alone is not authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineSessionAction {
    /// Claimed routine owner, checked against the immutable session owner.
    pub owner: MacroUserIdStr<'static>,
    /// Persona the routine selected, checked against the session.
    pub bot_id: BotId,
    /// Caller-generated UUIDv7 session id.
    pub session_id: AgentSessionId,
    /// Caller-generated UUIDv7 identifying the initial prompt, not a later turn.
    pub action_id: AgentActionId,
}

/// The first task sent to a prepared session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRoutineSession {
    /// Owner, persona, session, and initial action identity.
    pub action: RoutineSessionAction,
    /// Routine guidance, instructions, and context; not persona system settings.
    pub prompt: String,
    /// What made the routine fire, rendered ahead of the prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<trigger_context::TriggerContext>,
}

/// Prompt admission is not completion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutinePromptAccepted {
    /// The requested initial action id.
    pub action_id: AgentActionId,
    /// Whether admission queued the prompt rather than immediately sending it.
    pub queued: bool,
}

/// Content-free progress of the specific initial action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "reason", rename_all = "snake_case")]
pub enum RoutineActionStatus {
    /// No terminal evidence yet. The scheduler's execution deadline still applies.
    Pending(RoutinePendingReason),
    /// The initial turn explicitly ended normally.
    Succeeded,
    /// The initial turn explicitly ended unsuccessfully.
    Failed(RoutineFailureReason),
}

/// Why the action has not established completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutinePendingReason {
    /// The initial prompt has not appeared in authoritative history yet.
    AwaitingPrompt,
    /// The initial turn has no stop reason yet.
    Running,
    /// Human permission is required; routines never grant it themselves.
    Permission,
    /// Human input is required; routines never answer it themselves.
    Elicitation,
    /// The runtime disconnected without proving completion.
    Disconnected,
}

/// Closed, sanitized terminal outcomes. No transcript or runtime error text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutineFailureReason {
    /// Explicitly cancelled by the runtime.
    Cancelled,
    /// The agent declined the task.
    Refusal,
    /// Token budget exhausted.
    MaxTokens,
    /// Turn request budget exhausted.
    MaxTurnRequests,
    /// The runtime answered the prompt with an error.
    RuntimeError,
    /// An unrecognized stop reason is never success.
    UnknownStopReason,
}

/// One catalog tool call a routine step makes as its owner, outside any
/// agent session. The scheduler decides which tools a routine may call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallRoutineTool {
    /// User whose authority the call spends.
    pub owner: MacroUserIdStr<'static>,
    /// Catalog name, e.g. `UpdateThreadLabels`.
    pub tool: String,
    /// The tool's arguments, already rendered from the routine's templates.
    pub arguments: serde_json::Map<String, serde_json::Value>,
}

/// What a tool call did. A failure here is the tool's own answer about the
/// owner's data (a missing label, an invalid argument), not a transport error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RoutineToolOutcome {
    /// The tool ran; its output, or null when too large to return.
    Completed {
        /// The tool's JSON output.
        output: serde_json::Value,
    },
    /// The tool refused or failed, in its own words.
    Failed {
        /// Why, written for the routine's owner.
        message: String,
    },
}

/// Safe errors shared by internal adapters and the scheduler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum RoutineSessionError {
    /// Definitive refusal before Macro-funded work was accepted.
    #[cfg(feature = "admission")]
    #[error(transparent)]
    Admission(#[from] crate::domain::error::AiAdmissionError),
    /// Non-v7 execution ids, empty prompt, or blank supplied model.
    #[error("invalid routine session command")]
    InvalidCommand,
    /// Persona was deleted or is not an executable agent.
    #[error("selected agent is unavailable")]
    PersonaUnavailable,
    /// Persona access or session ownership was denied.
    #[error("routine owner is not authorized")]
    Forbidden,
    /// The owner has not connected an app the routine requires.
    #[error("connect every app this routine requires")]
    AppNotConnected,
    /// The selected agent's runtime opens its own sessions and cannot be
    /// handed the routine's apps.
    #[error("the selected agent cannot use apps added to a routine")]
    AppsUnsupported,
    /// A runtime could not serve the selected agent.
    #[error("selected runtime is unavailable")]
    RuntimeUnavailable,
    /// Preparation returned another owner's, persona's, or session's row.
    #[error("prepared session does not match the request")]
    SessionMismatch,
    /// The requested model was not applied before prompting.
    #[error("prepared session does not use the requested model")]
    ModelMismatch,
    /// Session already exists or has accepted a first prompt.
    #[error("routine session has already been used")]
    Conflict,
    /// Prompt admission failed and may already have taken effect. Never replay it.
    #[error("prompt delivery is uncertain; do not retry")]
    PromptDeliveryUnknown,
    /// A domain port failed; adapters must not expose its underlying details.
    #[error("routine session operation failed")]
    OperationFailed,
}
