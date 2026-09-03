//! The seam between the ACP surface and the agentic loop that serves it.

use agent::types::ChatMessage;
use agent::{AgentError, StreamPart};
use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// A model the in-memory runtime offers for session-level selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupportedModel {
    /// Provider-qualified id routed by the shared agent loop.
    pub id: &'static str,
    /// Human-readable label advertised over ACP.
    pub name: &'static str,
}

/// Default model for a new in-memory session.
pub const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-5";

/// Models users may select for in-memory agent sessions.
pub const SUPPORTED_MODELS: &[SupportedModel] = &[
    SupportedModel {
        id: DEFAULT_MODEL,
        name: "Sonnet 5",
    },
    SupportedModel {
        id: "anthropic/claude-opus-5",
        name: "Opus 5",
    },
    SupportedModel {
        id: "anthropic/claude-haiku-4-5",
        name: "Haiku 4.5",
    },
    SupportedModel {
        id: "openai/gpt-5.6",
        name: "GPT-5.6",
    },
    SupportedModel {
        id: "google/gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
    },
    SupportedModel {
        id: "google/gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
    },
];

/// Everything one conversational turn needs.
pub struct TurnRequest {
    /// Session the completion belongs to, used for usage attribution.
    pub session_id: AgentSessionId,
    /// The user the turn acts on behalf of. Tools run with their identity and
    /// token usage is recorded against them.
    pub owner: MacroUserIdStr<'static>,
    /// Model id the turn runs on. Unknown ids fall back to the loop's
    /// default model rather than failing the turn.
    pub model: String,
    /// The session's instructions, appended to the engine's own system
    /// prompt. `None` runs the engine's default prompt unchanged.
    pub instructions: Option<String>,
    /// The full conversation, oldest first, ending with the prompt being
    /// answered.
    pub messages: Vec<ChatMessage>,
    /// Cancelling this token stops the turn; the stream ends after the
    /// engine has drained cooperatively.
    pub cancel: CancellationToken,
}

/// Runs one conversational turn and streams its parts back.
///
/// The trait is the testing seam: the ACP surface is exercised against a
/// scripted engine, and production plugs in
/// [`crate::outbound::rig_engine::RigTurnEngine`].
pub trait TurnEngine: Send + Sync + 'static {
    /// Models this engine can serve in the current deployment.
    ///
    /// Test engines use the complete product catalog. Production engines may
    /// omit models whose provider credentials are not configured.
    fn supported_models(&self) -> &[SupportedModel] {
        SUPPORTED_MODELS
    }

    /// Start the turn. Parts arrive on the returned receiver; the stream
    /// ending is the turn ending, and an `Err` item is a turn-fatal failure.
    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>>;
}
