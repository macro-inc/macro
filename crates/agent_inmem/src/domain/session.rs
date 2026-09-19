//! Per-session conversational state, held in memory.
//!
//! The durable record of a session is its frame log; what lives here is only
//! the model-facing conversation the next turn is built from. It survives a
//! reattach within one process lifetime, and a cold attach after a restart
//! rebuilds it from the frame log (see [`crate::domain::replay`]).

use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent_client_protocol::schema::v1::SessionId;
use agent_session::domain::model::AgentSessionId;
use dashmap::DashMap;

/// One entry of the conversation, in the shape
/// [`agent::to_rig_messages`] round-trips.
#[derive(Debug, Clone)]
pub enum HistoryEntry {
    /// A prompt from a user.
    User(String),
    /// One assistant turn: text, tool calls, and tool results, flattened.
    Assistant(Vec<AssistantMessagePart>),
}

/// The in-memory state of one agent session.
#[derive(Debug)]
pub struct SessionState {
    /// The ACP session id minted by `session/new`, `None` until then.
    pub acp_session_id: Option<SessionId>,
    /// Model id turns run on; `session/set_config_option` moves it.
    pub model: String,
    /// Instructions every turn runs under, snapshotted from the session row
    /// at attach. Nothing moves them: they are the session's system prompt,
    /// and a conversation whose system prompt changed halfway is one the
    /// agent never agreed to.
    pub instructions: Option<String>,
    /// The conversation so far, oldest first.
    pub history: Vec<HistoryEntry>,
}

impl SessionState {
    /// A fresh session on `model` with no conversation yet.
    #[must_use]
    pub fn new(model: String) -> Self {
        Self {
            acp_session_id: None,
            model,
            instructions: None,
            history: Vec::new(),
        }
    }
}

/// Session state by Macro session id, shared between the manager (which
/// creates and tears down entries) and the agent tasks (which read and extend
/// them). Entries outlive individual agent tasks so a reattach keeps its
/// conversation.
pub type SessionStore = DashMap<AgentSessionId, SessionState>;

/// Materialize the conversation for one turn: the recorded history followed
/// by the prompt being answered.
#[must_use]
pub fn messages_for_turn(history: &[HistoryEntry], prompt: &str) -> Vec<ChatMessage> {
    history
        .iter()
        .map(|entry| match entry {
            HistoryEntry::User(text) => ChatMessage {
                content: ChatMessageContent::Text(text.clone()),
                role: Role::User,
                attachments: None,
            },
            HistoryEntry::Assistant(parts) => ChatMessage {
                content: ChatMessageContent::AssistantMessageParts(parts.clone()),
                role: Role::Assistant,
                attachments: None,
            },
        })
        .chain(std::iter::once(ChatMessage {
            content: ChatMessageContent::Text(prompt.to_owned()),
            role: Role::User,
            attachments: None,
        }))
        .collect()
}
