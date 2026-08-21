//! The pure Cursor→ACP translation.
//!
//! [`TranslateMachine`] takes one [`CursorEvent`] at a time and reports the
//! ACP [`SessionUpdate`]s it implies — usually one, often none. It is a state
//! machine rather than a function because two translations need memory:
//!
//! - Cursor sends the same `tool_call` event for the opening announcement and
//!   every later progress report; ACP distinguishes `tool_call` from
//!   `tool_call_update`, so the machine remembers which call ids it has
//!   announced.
//! - Cursor's typed tool descriptor (`interaction_update.toolCall.type`)
//!   always arrives *after* the bare-named `tool_call` event it describes, so
//!   the machine records it per call id to refine later updates — the opening
//!   announcement can only ever rely on the tool's name.
//!
//! Everything else is stateless mapping. Notably, `interaction_update`'s
//! `text-delta`/`thinking-delta` subtypes duplicate the `assistant` and
//! `thinking` events one-for-one on real streams — consuming both would
//! double every chunk — so the envelope is ignored except for the subtypes
//! that carry something unique.
//!
//! Cursor reports incremental output tokens (`token-delta`) but never a
//! context-window size, while ACP's `usage_update` reports context used out
//! of a sized window. Inventing a size would misrender in any client that
//! shows a percentage, so usage is deliberately not translated.

#[cfg(test)]
mod test;

use crate::domain::event::{CursorEvent, InteractionUpdate, ToolCallEvent};
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, SessionUpdate, TextContent, ToolCall, ToolCallStatus,
    ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use std::collections::{HashMap, HashSet};

/// Translates a run's event stream into ACP session updates, one event at a
/// time.
#[derive(Debug, Default)]
pub struct TranslateMachine {
    /// Call ids already announced, so repeats become `tool_call_update`.
    announced: HashSet<String>,
    /// Kinds learned from Cursor's typed tool descriptor, keyed by call id.
    learned_kinds: HashMap<String, ToolKind>,
}

impl TranslateMachine {
    /// A machine with no memory of any tool call.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Advance by one event, returning the updates it implies in order.
    pub fn push(&mut self, event: CursorEvent) -> Vec<SessionUpdate> {
        match event {
            CursorEvent::Assistant { text } => chunk(&text, SessionUpdate::AgentMessageChunk),
            CursorEvent::Thinking { text } => chunk(&text, SessionUpdate::AgentThoughtChunk),
            CursorEvent::ToolCall(call) => vec![self.tool_call(call)],
            CursorEvent::Interaction(update) => {
                self.interaction(&update);
                Vec::new()
            }
            // Lifecycle and keepalives: the session service consumes these as
            // the turn's boundary; they have no ACP counterpart.
            CursorEvent::Status { .. }
            | CursorEvent::Result { .. }
            | CursorEvent::Heartbeat
            | CursorEvent::Error { .. }
            | CursorEvent::Done => Vec::new(),
            CursorEvent::Unknown { event, .. } => {
                tracing::debug!(event, "ignoring unrecognized cursor event");
                Vec::new()
            }
        }
    }

    /// One `tool_call` event: an announcement the first time a call id is
    /// seen, an update after.
    fn tool_call(&mut self, call: ToolCallEvent) -> SessionUpdate {
        // Cursor call ids embed a literal newline (`call-…-0\nfc_…_0`) —
        // legal JSON, but it corrupts anything that renders an id on one
        // line, so it is collapsed before the id reaches ACP.
        let call_id = collapse_whitespace(&call.call_id);
        let kind = self
            .learned_kinds
            .get(&call_id)
            .copied()
            .unwrap_or_else(|| kind_from_tool_name(&call.name));
        let status = map_status(call.status.as_deref(), call.result.as_ref());

        if self.announced.insert(call_id.clone()) {
            let mut announcement = ToolCall::new(call_id, call.name)
                .kind(kind)
                .status(status)
                .raw_input(call.args);
            if let Some(result) = call.result {
                announcement = announcement.raw_output(wrap_result(result));
            }
            SessionUpdate::ToolCall(announcement)
        } else {
            let mut fields = ToolCallUpdateFields::new()
                .kind(kind)
                .status(status)
                .title(call.name)
                .raw_input(call.args);
            if let Some(result) = call.result {
                fields = fields.raw_output(wrap_result(result));
            }
            SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(call_id, fields))
        }
    }

    /// Record what the envelope teaches; it never emits an update itself.
    fn interaction(&mut self, update: &InteractionUpdate) {
        match update {
            InteractionUpdate::ToolCallStarted { call_id, tool_type }
            | InteractionUpdate::ToolCallCompleted { call_id, tool_type } => {
                if let Some(kind) = tool_type.as_deref().and_then(kind_from_cursor_type) {
                    self.learned_kinds
                        .insert(collapse_whitespace(call_id), kind);
                }
            }
            InteractionUpdate::UserMessage { .. }
            | InteractionUpdate::TokenDelta { .. }
            | InteractionUpdate::Other { .. } => {}
        }
    }
}

/// A text delta as the given chunk variant; empty deltas produce nothing.
fn chunk(text: &str, variant: impl Fn(ContentChunk) -> SessionUpdate) -> Vec<SessionUpdate> {
    if text.is_empty() {
        return Vec::new();
    }
    let content = ContentBlock::Text(TextContent::new(text));
    vec![variant(ContentChunk::new(content))]
}

/// Cursor's own typed tool descriptor mapped to an ACP kind.
///
/// Exhaustive over what real streams send: every arm below was read off a
/// recording, and a type that has not been observed returns `None` so the
/// name table decides instead. The previous version also mapped `write`,
/// `search`, `fetch` and `web`, none of which Cursor has ever sent — they were
/// guesses that would have answered confidently for types that do not exist.
///
/// Two arms are judgement rather than transcription, because ACP has no kind
/// that fits:
///
/// - `task` delegates to a subagent, which is not read, write, search or
///   execute. [`ToolKind::Other`] is what ACP has for "none of these".
/// - `mcp` invokes an arbitrary MCP tool, so its kind is genuinely unknown at
///   this layer — the call could do anything the server offers.
fn kind_from_cursor_type(tool_type: &str) -> Option<ToolKind> {
    Some(match tool_type {
        "shell" => ToolKind::Execute,
        "read" => ToolKind::Read,
        "edit" => ToolKind::Edit,
        "delete" => ToolKind::Delete,
        "glob" | "grep" => ToolKind::Search,
        // The closest ACP kind for a todo-list update. ACP models a plan
        // properly as `SessionUpdate::Plan`, which is where Cursor's
        // `todo_write` calls really belong; translating them there instead is
        // a change to the shape of a turn, not a kind mapping, so it is left
        // as follow-up.
        "updateTodos" => ToolKind::Think,
        "task" | "mcp" => ToolKind::Other,
        _ => return None,
    })
}

/// Every tool name a real Cursor stream has sent, and its ACP kind.
///
/// Cursor's documented `tool_call` event carries a name and nothing else, so
/// the opening announcement — the one a client renders first — can only be
/// classified from this. The typed descriptor that would refine it always
/// arrives afterwards, and for three of these tools (`get_mcp_tools`,
/// `web_fetch`, `web_search`) it never arrives at all, so for those the name
/// is the only signal there will ever be.
///
/// This used to be token matching: names were split on separators and
/// camelCase humps and looked up in a hand-written vocabulary. That answered
/// for tools that do not exist and quietly mis-answered for ones that do —
/// `todo_write` matched the `write` token and classified a todo update as a
/// file edit. An exact table cannot do that. The cost is that a genuinely new
/// Cursor tool lands in [`ToolKind::Other`] until it is added here, which is
/// the honest answer rather than a lucky one, and the corpus sweep's pinned
/// tool-call snapshot is what surfaces the new name.
const KIND_BY_TOOL_NAME: &[(&str, ToolKind)] = &[
    ("run_terminal_cmd", ToolKind::Execute),
    ("read_file", ToolKind::Read),
    ("edit_file", ToolKind::Edit),
    ("delete_file", ToolKind::Delete),
    ("file_search", ToolKind::Search),
    ("grep_search", ToolKind::Search),
    // Both retrieve data from outside the workspace, which is what ACP's
    // Fetch means. Neither carries a typed descriptor, so this is the only
    // classification they will ever get.
    ("web_fetch", ToolKind::Fetch),
    ("web_search", ToolKind::Fetch),
    ("todo_write", ToolKind::Think),
    // See `kind_from_cursor_type` for why these three are `Other`.
    ("task", ToolKind::Other),
    ("mcp", ToolKind::Other),
    ("get_mcp_tools", ToolKind::Other),
];

/// The ACP kind for a Cursor tool name, or [`ToolKind::Other`] for a name no
/// recording has produced.
#[must_use]
pub fn kind_from_tool_name(name: &str) -> ToolKind {
    KIND_BY_TOOL_NAME
        .iter()
        .find_map(|(candidate, kind)| (*candidate == name).then_some(*kind))
        .unwrap_or(ToolKind::Other)
}

/// Cursor's tool status mapped to an ACP status.
///
/// The two signals answer different questions, and both recorded failures
/// prove it:
///
/// - The **status word** says whether the call is *done*. It never says
///   whether it succeeded — no recorded stream has ever used the word
///   "failed", so a call that failed still arrives as `"completed"`
///   (`fixtures/real/read_and_search.sse`, whose `get_mcp_tools` call failed
///   with `status: "completed"`).
/// - The **result envelope** says whether the outcome was a success, but only
///   once there is an outcome. An error envelope on a still-running frame is
///   transient: `fixtures/real/mcp_servers.sse` has a call whose first frame
///   is `"running"` with `result: {"error": …}` and which then completes
///   successfully. Reading that as failure flickers the call to Failed and
///   back.
///
/// So the word decides *whether* the call is finished and the envelope decides
/// *how* — and neither is trusted for the other's question. Unknown words are
/// treated as in-flight: a status the crate cannot read is still progress.
fn map_status(status: Option<&str>, result: Option<&serde_json::Value>) -> ToolCallStatus {
    match status {
        Some("completed" | "success") => {
            if result.is_some_and(is_error_envelope) {
                ToolCallStatus::Failed
            } else {
                ToolCallStatus::Completed
            }
        }
        Some("failed" | "error") => ToolCallStatus::Failed,
        Some("pending") => ToolCallStatus::Pending,
        _ => ToolCallStatus::InProgress,
    }
}

/// Whether Cursor's result envelope reports a failure.
///
/// Results arrive as a single-key envelope — `{"success": …}` or
/// `{"error": …}`. Only the latter is a failure; a result that is neither
/// (a bare scalar, say) says nothing about the outcome.
fn is_error_envelope(result: &serde_json::Value) -> bool {
    result.get("error").is_some()
}

/// Cursor's raw result under a `result` key, so `rawOutput` is always an
/// object even when Cursor returns a bare scalar.
fn wrap_result(result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "result": result })
}

/// All whitespace runs collapsed to single spaces, trimmed.
fn collapse_whitespace(id: &str) -> String {
    id.split_whitespace().collect::<Vec<_>>().join(" ")
}
