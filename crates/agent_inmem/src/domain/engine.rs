//! The seam between the ACP surface and the agentic loop that serves it.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use agent::ReasoningEffort;
use agent::types::ChatMessage;
use agent::{AgentError, StreamPart};
use ai_tools::user_tool_review::UserToolReviewer;
use bot_id::BotId;
use mcp_toolset::RemoteMcpToolSet;
use model_owner::Owner;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::user_input::SharedUserInputRequester;

/// Who the agent is: the bot a session belongs to, by id and by name.
///
/// The name and handle go into the turn's system prompt so the model knows
/// who it is; the id and name also make the turn's tools act as that bot, so
/// what the agent writes is attributed to it - and presented under its name
/// wherever a reader sees the write happen, such as the cursor the editing
/// worker draws - rather than to Macro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentIdentity {
    /// The bot the session belongs to.
    pub bot: BotId,
    /// Display name, e.g. `Grunk`.
    pub name: String,
    /// Stable `@` handle without a leading `@`, e.g. `grunk`.
    pub handle: String,
}

/// Everything one conversational turn needs.
pub struct TurnRequest {
    /// The session the turn belongs to.
    pub session_id: agent_session::domain::model::AgentSessionId,
    /// Counts what the turn is waiting on a person for - a question, or a
    /// tool call held for the owner - so the idle timeout leaves it be.
    pub awaiting: Arc<AwaitingUser>,
    /// The session's owner, whom the turn acts on behalf of: tools run with
    /// their identity and token usage is recorded against them. Both need a
    /// person, which the engine asks of this rather than assumes.
    pub owner: Owner,
    /// Model id the turn runs on. Unknown ids fall back to the loop's
    /// default model rather than failing the turn.
    pub model: String,
    /// Provider-independent effort selected for this session.
    pub reasoning_effort: ReasoningEffort,
    /// Who this agent is. Folded into every turn's system prompt so the
    /// model can answer "who are you" even when the session has no
    /// instructions. `None` leaves the standing prompt unnamed.
    pub identity: Option<AgentIdentity>,
    /// The session's instructions, appended to the engine's own system
    /// prompt. `None` runs the engine's default prompt unchanged.
    pub instructions: Option<String>,
    /// The full conversation, oldest first, ending with the prompt being
    /// answered.
    pub messages: Vec<ChatMessage>,
    /// Tools of the MCP servers the session was handed, composed next to the
    /// native Macro tools. `None` when the session has none.
    pub mcp_tools: Option<RemoteMcpToolSet>,
    /// Cancelling this token stops the turn; the stream ends after the
    /// engine has drained cooperatively.
    pub cancel: CancellationToken,
    /// User-input capability for model-callable tools. Absent when the ACP
    /// client did not advertise form elicitation.
    pub user_input: Option<SharedUserInputRequester>,
    /// Puts a user tool's call (`SendEmail`, `CreateCalendarEvent`) to the
    /// user for review mid-turn, so the tool is finished - run as edited, or
    /// rejected - before the model reads its result. Absent for the same
    /// reason as `user_input`; a pending call then stays pending.
    pub reviewer: Option<Arc<dyn UserToolReviewer>>,
}

/// How many things a turn currently waits on a person for. Shared between
/// whatever is waiting (a question to the user, a tool call held for the
/// owner), which counts itself in, and the turn loop, which reads it to tell
/// "waiting on someone" from "hung".
#[derive(Debug, Default)]
pub struct AwaitingUser(AtomicUsize);

impl AwaitingUser {
    /// Whether anything is being waited on.
    #[must_use]
    pub fn is_waiting(&self) -> bool {
        self.0.load(Ordering::Acquire) > 0
    }

    /// Count one wait until the guard drops - on an answer, an error, or the
    /// waiting future being cancelled.
    pub fn begin(&self) -> AwaitingGuard<'_> {
        self.0.fetch_add(1, Ordering::AcqRel);
        AwaitingGuard(self)
    }
}

/// One wait, counted until dropped.
pub struct AwaitingGuard<'a>(&'a AwaitingUser);

impl Drop for AwaitingGuard<'_> {
    fn drop(&mut self) {
        self.0.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Runs one conversational turn and streams its parts back.
///
/// The trait is the testing seam: the ACP surface is exercised against a
/// scripted engine, and production plugs in
/// [`crate::rig_engine::RigTurnEngine`].
pub trait TurnEngine: Send + Sync + 'static {
    /// Model ids this engine deployment can run and therefore advertises over
    /// ACP. The order is the picker order.
    fn supported_models(&self) -> &[&str];

    /// Start the turn. Parts arrive on the returned receiver; the stream
    /// ending is the turn ending, and an `Err` item is a turn-fatal failure.
    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>>;
}
