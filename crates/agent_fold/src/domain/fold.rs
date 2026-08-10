//! Collapsing a session's protocol log into renderable messages.
//!
//! # Why this cannot fail
//!
//! [`fold`] is total. Messages are derived on every read, so returning an
//! error would mean rendering an empty channel - strictly worse than rendering
//! a partially-understood session. Every case that looks like a failure is
//! instead a state worth showing:
//!
//! - A tool call with no result is in flight, or was interrupted when the
//!   session died. Its status stays [`ToolStatus::Pending`].
//! - A tool call whose opening frame carried no useful fields gets them from
//!   later patches. Until then it renders as a bare tool row.
//! - A permission request with no answer is outstanding.
//!
//! What is left over - a patch for a tool call that was never opened, an
//! update variant this fold does not model - is logged through [`FoldError`]
//! at [`tracing::Level::WARN`] instead, rather than aborting or being
//! threaded through the return value. That keeps the render path lenient
//! while letting tests be strict: a replay test asserts that folding a
//! recording logs nothing, so protocol drift fails loudly locally (where the
//! recordings live) rather than silently degrading in production.
//!
//! # Why one match rather than a registry
//!
//! Dispatch is a single explicit `match` over the protocol, in [`step`] and
//! the handlers it calls. A registry of self-describing handlers would move
//! the decision of what matches what into data, where it is invisible; here
//! every frame this fold understands is named in one place you can read
//! top-to-bottom, and every frame it ignores is an explicit arm.

use crate::domain::error::FoldError;
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::meta::{claude_code, command_from_raw_input};
use crate::domain::model::{
    AnsiText, Author, FileDiff, FoldedMessage, MessagePart, Permission, PermissionOption,
    PermissionOutcome, StopReason, ToolDetail, ToolStatus, ToolUse, ToolUseId, TurnId,
};
use crate::domain::ports::{FoldSession, LogRepo};
use agent_client_protocol::schema::v1::{
    ContentBlock, Meta, RequestId, Response, SessionUpdate, ToolCall, ToolCallContent,
    ToolCallStatus, ToolCallUpdate, ToolKind,
};
use agent_client_protocol::{RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

/// Collapse a session's protocol log into renderable messages.
///
/// A state machine driven by [`Iterator::fold`]: [`State`] is the machine,
/// [`step`] is its transition function, and [`State::finish`] closes out
/// whatever the final state left open.
///
/// Total by construction: unrecognized and incomplete frames are logged
/// through [`FoldError`] rather than aborting the fold. See the module docs
/// for why.
#[must_use]
pub fn fold(log: impl IntoIterator<Item = AgentSessionLog>) -> Vec<FoldedMessage> {
    log.into_iter().fold(State::default(), step).finish()
}

/// The state machine's transition function: advance [`State`] by one log
/// entry. Passed by name to [`Iterator::fold`] in [`fold`].
fn step(mut state: State, entry: AgentSessionLog) -> State {
    state.session = Some(entry.agent_session_id);

    // The one place the protocol is dispatched. Each arm names a frame
    // this fold understands; the rest are ignored on purpose.
    match &entry.content {
        Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => match &acp.0 {
            // A user's prompt opens a turn.
            RawJsonRpcMessage::Request(request) if &*request.method == "session/prompt" => {
                state.begin_turn(&request.id, request.params.as_ref(), entry.user_id.clone());
            }
            // The user's answer to a permission request.
            RawJsonRpcMessage::Response(Response::Result { id, result }) => {
                state.resolve_permission(id, Some(result));
            }
            RawJsonRpcMessage::Response(Response::Error { id, .. }) => {
                state.resolve_permission(id, None);
            }
            // Handshake and configuration traffic: nothing to render.
            RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => {}
        },

        Message::ToServer(ToServerMessage::Acp(acp)) => match &acp.0 {
            // The bulk of the log: streamed content and tool activity.
            RawJsonRpcMessage::Notification(notification)
                if &*notification.method == "session/update" =>
            {
                state.apply_session_update(notification.params.as_ref());
            }
            // The agent asking to proceed.
            RawJsonRpcMessage::Request(request)
                if &*request.method == "session/request_permission" =>
            {
                state.request_permission(&request.id, request.params.as_ref());
            }
            // The response to `session/prompt` closes the turn.
            RawJsonRpcMessage::Response(Response::Result { id, result }) => {
                state.end_turn(id, Some(result));
            }
            RawJsonRpcMessage::Response(Response::Error { id, .. }) => {
                state.end_turn(id, None);
            }
            RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => {}
        },

        // Runtime lifecycle events carry no conversation content. The one
        // the service acts on, `acp_ready`, is a handshake signal.
        Message::ToServer(ToServerMessage::Event { .. }) => {}

        // The wrapped protocol enums are `#[non_exhaustive]`.
        Message::ToServer(_) | Message::ToRuntime(_) => {}
    }

    state
}

impl<T: LogRepo + Sync> FoldSession for T {
    /// Read the session's log through [`LogRepo`] and fold it.
    ///
    /// The one place [`fold`] meets storage: everywhere else in this crate
    /// only knows how to fold an iterator, never where it came from.
    async fn fold_session(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<FoldedMessage>, rootcause::Report> {
        let log = self.list_by_session(session).await?;
        Ok(fold(log))
    }
}

/// The fold's state machine: the accumulator threaded through
/// [`Iterator::fold`] by [`fold`], advanced one log entry at a time by
/// [`step`].
#[derive(Default)]
struct State {
    messages: Vec<FoldedMessage>,
    /// The session the entry currently being folded belongs to, for
    /// [`State::warn`]. Set fresh from each log entry, so it is always
    /// current even though it rarely changes within one fold.
    session: Option<AgentSessionId>,
    /// The turn currently being built, if any.
    turn: Option<Turn>,
    /// How many turns have been opened, which is also the next [`TurnId`].
    turns_opened: u32,
    /// Outstanding permission requests, by the id of the request that asked.
    pending_permissions: HashMap<RequestId, ToolUseId>,
}

/// A turn under construction.
struct Turn {
    id: TurnId,
    /// The `session/prompt` request whose response will close this turn.
    prompt_id: RequestId,
    /// Parts of the agent's reply, in arrival order.
    parts: Vec<MessagePart>,
    /// Where each tool call sits in `parts`, so patches can find it.
    tool_positions: HashMap<ToolUseId, usize>,
    /// Where each permission sits in `parts`, so outcomes can find it.
    permission_positions: HashMap<ToolUseId, usize>,
}

impl State {
    /// Handle a `session/prompt`: emit the user's message, open a turn.
    fn begin_turn(
        &mut self,
        prompt_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
        user_id: Option<MacroUserIdStr<'static>>,
    ) {
        // A second prompt without an intervening response means the previous
        // turn never got one. Close it out so its content is not lost.
        self.close_turn(None);

        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;

        let text = param(params, "prompt")
            .and_then(|prompt| prompt.as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| ContentBlock::deserialize(block).ok())
                    .filter_map(content_block_text)
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();

        if !text.is_empty() {
            self.push_message(FoldedMessage {
                id,
                author: Author::User(user_id),
                parts: NonEmpty::new(vec![MessagePart::Text(text)])
                    .expect("checked non-empty above"),
                stop: None,
            });
        }

        self.turn = Some(Turn {
            id,
            prompt_id: prompt_id.clone(),
            parts: Vec::new(),
            tool_positions: HashMap::new(),
            permission_positions: HashMap::new(),
        });
    }

    /// Handle the response to `session/prompt`: close the turn.
    fn end_turn(&mut self, response_id: &RequestId, value: Option<&serde_json::Value>) {
        let is_current_turn = self
            .turn
            .as_ref()
            .is_some_and(|turn| &turn.prompt_id == response_id);

        if !is_current_turn {
            // Responses to `initialize`, `session/new` and `session/load`
            // land here. Only flag one that looks like a turn ending.
            if value.is_some_and(|value| value.get("stopReason").is_some()) {
                self.warn(FoldError::UncorrelatedResponse);
            }
            return;
        }

        let stop = value
            .and_then(|value| value.get("stopReason"))
            .and_then(|reason| reason.as_str())
            .map(stop_reason);

        self.close_turn(stop);
    }

    /// Handle a `session/update`.
    fn apply_session_update(&mut self, params: Option<&RawJsonRpcParams>) {
        // Only the `update` field is folded; the rest of the notification
        // (session id, meta) carries nothing renderable. Borrowed out of the
        // params rather than cloning them - `session/update` is the bulk of
        // any log, so this is the fold's hot path.
        let Some(update_value) = param(params, "update") else {
            self.warn(FoldError::Unknown {
                kind: "<missing params>".to_owned(),
            });
            return;
        };

        // Keep the wire name before decoding, so an unmodelled variant can be
        // named in the anomaly even though `SessionUpdate` is non-exhaustive.
        let wire_kind = update_value
            .get("sessionUpdate")
            .and_then(|kind| kind.as_str())
            .unwrap_or("<missing>")
            .to_owned();

        let Ok(update) = SessionUpdate::deserialize(update_value) else {
            self.warn(FoldError::Unknown { kind: wire_kind });
            return;
        };

        match update {
            // Prose from the agent. Chunks are appended to the open text part
            // rather than each becoming a part of its own.
            SessionUpdate::AgentMessageChunk(chunk) => {
                if let Some(text) = content_block_text(chunk.content) {
                    self.append_text(text);
                }
            }
            // Reasoning, kept separate so a reader can collapse it.
            SessionUpdate::AgentThoughtChunk(chunk) => {
                if let Some(text) = content_block_text(chunk.content) {
                    self.append_thought(text);
                }
            }
            // The agent replaying the user's own message. The prompt frame is
            // the authoritative copy, so this is dropped.
            SessionUpdate::UserMessageChunk(_) => {}
            SessionUpdate::ToolCall(call) => self.open_tool_call(call),
            SessionUpdate::ToolCallUpdate(update) => self.patch_tool_call(update),
            // Deliberately dropped: token accounting and session bookkeeping,
            // none of which a reader wants in a channel. `usage_update` alone
            // is 81 of ~450 frames in a recorded session.
            SessionUpdate::UsageUpdate(_)
            | SessionUpdate::SessionInfoUpdate(_)
            | SessionUpdate::AvailableCommandsUpdate(_)
            | SessionUpdate::CurrentModeUpdate(_)
            | SessionUpdate::ConfigOptionUpdate(_) => {}
            // Plans are renderable and worth folding, but no recorded session
            // has produced one yet, so there is nothing to verify a shape
            // against. Logged rather than guessed at.
            SessionUpdate::Plan(_) => self.warn(FoldError::Unknown { kind: wire_kind }),
            _ => self.warn(FoldError::Unknown { kind: wire_kind }),
        }
    }

    /// Handle a `tool_call`: add a new tool part.
    fn open_tool_call(&mut self, call: ToolCall) {
        let id = ToolUseId(call.tool_call_id.0.to_string());
        let label =
            claude_code::tool_name(call.meta.as_ref()).unwrap_or_else(|| call.title.clone());

        let tool = ToolUse {
            id: id.clone(),
            label,
            status: tool_status(call.status),
            detail: tool_detail(
                call.kind,
                call.raw_input.as_ref(),
                &call.content,
                call.meta.as_ref(),
            ),
        };

        let Some(turn) = self.turn.as_mut() else {
            return;
        };

        // A repeated open for the same id patches in place rather than
        // duplicating the row.
        if let Some(&position) = turn.tool_positions.get(&id) {
            if let Some(MessagePart::ToolUse(existing)) = turn.parts.get_mut(position) {
                *existing = tool;
            }
            return;
        }

        turn.tool_positions.insert(id, turn.parts.len());
        turn.parts.push(MessagePart::ToolUse(tool));
    }

    /// Handle a `tool_call_update`: patch an existing tool part.
    ///
    /// Only fields the update actually carries are written, since
    /// `ToolCallUpdateFields` is entirely optional and a typical call is
    /// patched several times - the recordings average about four updates per
    /// call.
    fn patch_tool_call(&mut self, update: ToolCallUpdate) {
        let id = ToolUseId(update.tool_call_id.0.to_string());

        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        let Some(&position) = turn.tool_positions.get(&id) else {
            self.warn(FoldError::PatchBeforeOpen { tool_call: id });
            return;
        };
        let Some(MessagePart::ToolUse(tool)) = turn.parts.get_mut(position) else {
            return;
        };

        let fields = update.fields;

        if let Some(status) = fields.status {
            tool.status = tool_status(status);
        }
        if let Some(title) = fields.title {
            // A harness-supplied name outranks any ACP title, so only take
            // the title when nothing better is already set.
            if claude_code::tool_name(update.meta.as_ref()).is_none() && tool.label.is_empty() {
                tool.label = title;
            }
        }
        if let Some(name) = claude_code::tool_name(update.meta.as_ref()) {
            tool.label = name;
        }

        patch_detail(
            &mut tool.detail,
            fields.raw_input.as_ref(),
            fields.content.as_deref(),
            update.meta.as_ref(),
        );
    }

    /// Handle a `session/request_permission`: add a permission part and record
    /// the request id so its response can be matched.
    fn request_permission(&mut self, request_id: &RequestId, params: Option<&RawJsonRpcParams>) {
        let Some(tool_call) = param(params, "toolCall")
            .and_then(|call| call.get("toolCallId"))
            .and_then(|id| id.as_str())
            .map(|id| ToolUseId(id.to_owned()))
        else {
            return;
        };

        let options = param(params, "options")
            .and_then(|options| options.as_array())
            .map(|options| {
                options
                    .iter()
                    .filter_map(|option| {
                        Some(PermissionOption {
                            id: option.get("optionId")?.as_str()?.to_owned(),
                            name: option.get("name")?.as_str()?.to_owned(),
                            kind: option.get("kind")?.as_str()?.to_owned(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        self.pending_permissions
            .insert(request_id.clone(), tool_call.clone());

        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        turn.permission_positions
            .insert(tool_call.clone(), turn.parts.len());
        turn.parts.push(MessagePart::Permission(Permission {
            tool_call,
            options,
            outcome: None,
        }));
    }

    /// Handle the response to a permission request.
    fn resolve_permission(&mut self, response_id: &RequestId, value: Option<&serde_json::Value>) {
        let Some(tool_call) = self.pending_permissions.remove(response_id) else {
            return;
        };

        // `{"outcome": {"outcome": "selected", "optionId": "..."}}`
        let outcome =
            value
                .and_then(|value| value.get("outcome"))
                .and_then(|outcome| {
                    match outcome.get("outcome").and_then(|kind| kind.as_str())? {
                        "selected" => Some(PermissionOutcome::Selected {
                            option_id: outcome.get("optionId")?.as_str()?.to_owned(),
                        }),
                        "cancelled" => Some(PermissionOutcome::Cancelled),
                        _ => None,
                    }
                });

        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        let Some(&position) = turn.permission_positions.get(&tool_call) else {
            return;
        };
        if let Some(MessagePart::Permission(permission)) = turn.parts.get_mut(position) {
            permission.outcome = outcome;
        }
    }

    /// Append agent prose, extending the trailing text part when there is one.
    fn append_text(&mut self, text: String) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        match turn.parts.last_mut() {
            Some(MessagePart::Text(existing)) => existing.push_str(&text),
            _ => turn.parts.push(MessagePart::Text(text)),
        }
    }

    /// Append agent reasoning, extending the trailing thought part when there
    /// is one.
    fn append_thought(&mut self, text: String) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        match turn.parts.last_mut() {
            Some(MessagePart::Thought(existing)) => existing.push_str(&text),
            _ => turn.parts.push(MessagePart::Thought(text)),
        }
    }

    /// Emit the open turn's agent message, if it produced anything.
    fn close_turn(&mut self, stop: Option<StopReason>) {
        let Some(turn) = self.turn.take() else { return };

        if let Ok(parts) = NonEmpty::new(turn.parts) {
            self.push_message(FoldedMessage {
                id: turn.id,
                author: Author::Agent,
                parts,
                stop,
            });
        }
    }

    fn push_message(&mut self, message: FoldedMessage) {
        self.messages.push(message);
    }

    /// Log a frame the fold could not account for. Not fatal - see the
    /// module docs - so this only ever logs and never returns an error.
    fn warn(&self, error: FoldError) {
        tracing::warn!(
            session = ?self.session,
            error = ?error,
            "agent session log frame could not be folded"
        );
    }

    /// Close any turn still open - a live or abandoned session - and return.
    fn finish(mut self) -> Vec<FoldedMessage> {
        self.close_turn(None);
        self.messages
    }
}

/// The text carried by a content block, if it carries any.
fn content_block_text(block: ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(text) => Some(text.text),
        // Images, audio, resource links and embedded resources have no text
        // to fold. Rendering them is a separate problem from this one.
        _ => None,
    }
}

/// Build a [`ToolDetail`] from a tool call's opening frame.
fn tool_detail(
    kind: ToolKind,
    raw_input: Option<&serde_json::Value>,
    content: &[ToolCallContent],
    meta: Option<&Meta>,
) -> ToolDetail {
    match kind {
        ToolKind::Execute => ToolDetail::Terminal {
            command: command_from_raw_input(raw_input),
            output: claude_code::terminal_output(meta).map(AnsiText),
            exit_code: claude_code::terminal_exit_code(meta),
        },
        ToolKind::Edit => ToolDetail::Edit {
            diffs: diffs(content),
        },
        ToolKind::Read => ToolDetail::Read {
            paths: read_paths(raw_input),
        },
        other => ToolDetail::Other {
            kind: tool_kind_name(other).to_owned(),
            input: raw_input.cloned(),
        },
    }
}

/// Write an update's fields into an existing detail, leaving what it does not
/// carry untouched.
fn patch_detail(
    detail: &mut ToolDetail,
    raw_input: Option<&serde_json::Value>,
    content: Option<&[ToolCallContent]>,
    meta: Option<&Meta>,
) {
    match detail {
        ToolDetail::Terminal {
            command,
            output,
            exit_code,
        } => {
            if let Some(found) = command_from_raw_input(raw_input) {
                *command = Some(found);
            }
            // Each update carries the output accumulated so far, so replace.
            if let Some(found) = claude_code::terminal_output(meta) {
                *output = Some(AnsiText(found));
            }
            if let Some(found) = claude_code::terminal_exit_code(meta) {
                *exit_code = Some(found);
            }
        }
        ToolDetail::Edit { diffs: existing } => {
            if let Some(content) = content {
                let found = diffs(content);
                if !found.is_empty() {
                    *existing = found;
                }
            }
        }
        ToolDetail::Read { paths } => {
            let found = read_paths(raw_input);
            if !found.is_empty() {
                *paths = found;
            }
        }
        ToolDetail::Other { input, .. } => {
            if let Some(found) = raw_input {
                *input = Some(found.clone());
            }
        }
    }
}

/// The diffs among a tool call's content blocks.
fn diffs(content: &[ToolCallContent]) -> Vec<FileDiff> {
    content
        .iter()
        .filter_map(|block| match block {
            ToolCallContent::Diff(diff) => Some(FileDiff {
                path: diff.path.clone(),
                old_text: diff.old_text.clone(),
                new_text: diff.new_text.clone(),
            }),
            _ => None,
        })
        .collect()
}

/// The paths a read tool was pointed at.
fn read_paths(raw_input: Option<&serde_json::Value>) -> Vec<PathBuf> {
    raw_input
        .and_then(|input| input.get("file_path"))
        .and_then(|path| path.as_str())
        .map(|path| vec![PathBuf::from(path)])
        .unwrap_or_default()
}

fn tool_status(status: ToolCallStatus) -> ToolStatus {
    match status {
        ToolCallStatus::Pending => ToolStatus::Pending,
        ToolCallStatus::InProgress => ToolStatus::Running,
        ToolCallStatus::Completed => ToolStatus::Completed,
        ToolCallStatus::Failed => ToolStatus::Failed,
        // `ToolCallStatus` is `#[non_exhaustive]`; an unknown status has not
        // demonstrably finished.
        _ => ToolStatus::Pending,
    }
}

fn tool_kind_name(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        ToolKind::Other => "other",
        _ => "unknown",
    }
}

fn stop_reason(wire: &str) -> StopReason {
    match wire {
        "end_turn" => StopReason::EndTurn,
        "max_tokens" => StopReason::MaxTokens,
        "max_turn_requests" => StopReason::MaxTurnRequests,
        "refusal" => StopReason::Refusal,
        "cancelled" => StopReason::Cancelled,
        other => StopReason::Other(other.to_owned()),
    }
}

/// A named JSON-RPC param, borrowed. `None` for positional params - every
/// frame this fold reads carries an object.
fn param<'params>(
    params: Option<&'params RawJsonRpcParams>,
    key: &str,
) -> Option<&'params serde_json::Value> {
    match params? {
        RawJsonRpcParams::Object(map) => map.get(key),
        RawJsonRpcParams::Array(_) => None,
    }
}
