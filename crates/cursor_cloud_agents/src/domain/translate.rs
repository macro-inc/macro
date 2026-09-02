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
    ContentBlock, ContentChunk, Diff, SessionUpdate, TextContent, ToolCall, ToolCallContent,
    ToolCallLocation, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use std::collections::{HashMap, HashSet};

/// Translates a run's event stream into ACP session updates, one event at a
/// time.
#[derive(Debug, Default)]
pub struct TranslateMachine {
    /// Call ids announced and not yet terminal, so repeats become
    /// `tool_call_update` and a turn that ends early knows what it left
    /// open. A call id leaves this set the moment it reports `Completed` or
    /// `Failed` — it re-entering would mean Cursor reused a finished id,
    /// which has never been observed.
    open: HashSet<String>,
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
        // The path a client needs to label the row, from wherever this frame
        // happens to carry it: an in-flight edit names it in `args`, a finished
        // call in its result envelope. `locations` is ACP's own field for this
        // and Cursor fills in nothing there, so read and delete rows arrive
        // with no path at all today. Left unset rather than empty when there
        // is no path — a shell command touches no file, and an empty array is
        // payload that says nothing.
        let locations = touched_path(call.args.as_ref(), call.result.as_ref())
            .map(|path| vec![ToolCallLocation::new(path)]);
        // A finished edit reports the file whole, before and after, which is
        // exactly an ACP diff. Only on the finished frame: an in-flight edit's
        // `streamContent` is the changed *region*, and rendering that as the
        // new file would claim everything else was deleted.
        let diff = call.result.as_ref().and_then(edit_diff);

        // Captured before the status below can remove it: a call id is only
        // ever a fresh announcement the first time it is seen, even when
        // that first frame already reports it terminal.
        let is_new = self.open.insert(call_id.clone());
        if matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed) {
            self.open.remove(&call_id);
        }

        if is_new {
            let mut announcement = ToolCall::new(call_id, call.name)
                .kind(kind)
                .status(status)
                .raw_input(call.args);
            if let Some(locations) = locations {
                announcement = announcement.locations(locations);
            }
            if let Some(diff) = diff {
                announcement = announcement.content(vec![ToolCallContent::Diff(diff)]);
            }
            if let Some(result) = call.result {
                announcement = announcement.raw_output(wrap_result(result));
            }
            SessionUpdate::ToolCall(announcement)
        } else {
            let mut fields = ToolCallUpdateFields::new()
                .kind(kind)
                .status(status)
                .title(call.name)
                .locations(locations)
                .raw_input(call.args);
            if let Some(diff) = diff {
                fields = fields.content(vec![ToolCallContent::Diff(diff)]);
            }
            if let Some(result) = call.result {
                fields = fields.raw_output(wrap_result(result));
            }
            SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(call_id, fields))
        }
    }

    /// Force every call still open to a terminal status, for a turn that
    /// ended without Cursor ever reporting one.
    ///
    /// A cancelled run's `result` frame is the turn's terminal signal; it
    /// does not always carry a completed `tool_call` for work that was
    /// mid-flight. A call still running at that moment would otherwise never
    /// receive one — the client is left rendering it in progress forever.
    /// `Failed` is the honest status to close it with: ACP v1 has no
    /// `cancelled` tool-call status, and Cursor never actually reported an
    /// outcome for these, so `Completed` would claim a success nobody
    /// witnessed.
    pub fn close_open_calls(&mut self) -> Vec<SessionUpdate> {
        self.open
            .drain()
            .map(|call_id| {
                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    call_id,
                    ToolCallUpdateFields::new().status(ToolCallStatus::Failed),
                ))
            })
            .collect()
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

/// The success payload of Cursor's single-key result envelope.
///
/// Everything worth reading out of a finished call lives under `success`; an
/// `{"error": …}` envelope has nothing to offer here, and is left to
/// [`map_status`] to turn into a failed call.
fn success(result: &serde_json::Value) -> Option<&serde_json::Value> {
    result.get("success")
}

/// A finished file edit as an ACP diff.
///
/// Recognized by the shape of the payload rather than the tool's name, so a
/// `write`-style sibling reporting the same fields gets a diff too and a
/// renamed tool does not silently lose one. `afterFullFileContent` is the
/// discriminator: `read_file` also reports a `path` and must not be mistaken
/// for an edit.
///
/// `beforeFullFileContent` is absent exactly when the file is new — the
/// corpus pairs that with a `--- /dev/null` header — which is what ACP's
/// `old_text: None` means, so the absence maps across directly.
///
/// Cursor's own `diffString` goes unread: ACP renders from the two full texts,
/// and there is nowhere in the protocol to put a unified patch.
fn edit_diff(result: &serde_json::Value) -> Option<Diff> {
    let success = success(result)?;
    let path = success.get("path")?.as_str()?;
    let after = success.get("afterFullFileContent")?.as_str()?;
    let before = success
        .get("beforeFullFileContent")
        .and_then(serde_json::Value::as_str);
    Some(Diff::new(path, after).old_text(before.map(str::to_owned)))
}

/// The file a call touched, from the result envelope or, while it is still
/// running, from its input.
///
/// Deliberately not restricted to edits: `read_file` and `delete_file` name a
/// path the same way, and the fold reads `locations` for those rows too.
fn touched_path(
    args: Option<&serde_json::Value>,
    result: Option<&serde_json::Value>,
) -> Option<String> {
    let from_result = result
        .and_then(success)
        .and_then(|success| success.get("path"))
        .and_then(serde_json::Value::as_str);
    let from_args = args
        .and_then(|args| args.get("path"))
        .and_then(serde_json::Value::as_str);
    from_result.or(from_args).map(str::to_owned)
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
