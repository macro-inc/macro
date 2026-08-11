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
//! Dispatch is a single explicit `match` over the protocol, in [`State::step`]
//! and the handlers it calls. A registry of self-describing handlers would
//! move the decision of what matches what into data, where it is invisible;
//! here every frame this fold understands is named in one place you can read
//! top-to-bottom, and every frame it ignores is an explicit arm.
//!
//! # Why the machine, and not `Iterator::fold`
//!
//! [`FoldMachineImpl`] is the fold; [`fold`] is a loop over it. The batch
//! form used to be primary - `log.into_iter().fold(State::default(), step)` -
//! and that shape forced two things this crate can no longer afford. It could
//! only answer "what does this whole log derive", so `agent_session` refolded
//! every session from scratch on every appended frame; and it held a turn's
//! agent message aside until the turn closed, so there was nothing to show a
//! reader while the agent was still talking.
//!
//! So the state is now a struct you push frames into. A turn's agent message
//! is pushed into [`State::messages`] the moment the agent produces its first
//! part and mutated in place afterwards, and each push reports which message
//! it touched. Both callers read the same machine: [`fold`] drives it to the
//! end and takes the messages, while a live session watches the per-push
//! reports. Deriving both from one implementation is what keeps them
//! agreeing - and they must agree exactly, because a
//! [`MessageId`](crate::domain::model::MessageId) derived here is persisted
//! on a comms placeholder row.

use std::borrow::Cow;

use crate::domain::error::FoldError;
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::meta::{claude_code, command_from_raw_input};
use crate::domain::model::{
    AnsiText, Author, FileDiff, FoldedMessage, IncrementalFoldResult, MessagePart, Permission,
    PermissionOption, PermissionOptionKind, PermissionOutcome, StopReason, ToolDetail, ToolStatus,
    ToolUse, ToolUseId, TurnId,
};
use crate::domain::ports::{FoldMachine, FoldSession, LogRepo};
use agent_client_protocol::schema::v1::{
    ContentBlock, Meta, PromptRequest, RequestId, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, Response, SessionNotification,
    SessionUpdate, ToolCall, ToolCallContent, ToolCallStatus, ToolCallUpdate, ToolKind,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

/// Collapse a session's protocol log into renderable messages.
///
/// Drives a [`FoldMachineImpl`] to the end of the log and takes what it
/// derived. The per-frame reports are discarded - a caller that wants them
/// pushes into the machine itself.
///
/// Total by construction: unrecognized and incomplete frames are logged
/// through [`FoldError`] rather than aborting the fold. See the module docs
/// for why.
#[must_use]
pub fn fold(log: impl IntoIterator<Item = AgentSessionLog>) -> Vec<FoldedMessage> {
    fold_machine(log).into_messages()
}

fn fold_machine(log: impl IntoIterator<Item = AgentSessionLog>) -> FoldMachineImpl {
    let mut machine = FoldMachineImpl::new();
    for entry in log {
        let _ = machine.push(entry);
    }
    machine
}

/// The incremental fold: push a session's log frames in one at a time and it
/// reports which message each changed.
///
/// Holds the fold's whole [`State`], including every message derived so far,
/// which is what makes it both the incremental fold and the store the
/// [`IncrementalFoldResult`]s borrow from. See the module docs for why the
/// machine rather than a batch fold.
///
/// Frames must be pushed in log order. A machine only ever grows, so a caller
/// tracking a live session keeps one per session and pushes for as long as
/// the session lasts.
#[derive(Debug, Default)]
pub struct FoldMachineImpl {
    state: FoldState,
}

impl FoldMachineImpl {
    /// A machine that has folded nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every message derived so far, oldest first.
    ///
    /// Includes the open turn's agent message, still being appended to. There
    /// is nothing to finalize: a message is complete the moment no further
    /// frame touches it.
    #[must_use]
    pub fn messages(&self) -> &[FoldedMessage] {
        &self.state.messages
    }

    /// Every message derived so far, giving up the machine.
    #[must_use]
    pub fn into_messages(self) -> Vec<FoldedMessage> {
        self.state.messages
    }

    /// Turn id the next prompt pushed into this machine will open.
    #[must_use]
    pub fn next_turn_id(&self) -> TurnId {
        TurnId(self.state.turns_opened)
    }
}

impl FoldMachine for FoldMachineImpl {
    fn push(&mut self, log: AgentSessionLog) -> IncrementalFoldResult<'_> {
        let Some(changed) = self.state.step(log) else {
            return IncrementalFoldResult::Unchanged;
        };
        let Some(message) = self.state.messages.get(changed.message) else {
            return IncrementalFoldResult::Unchanged;
        };
        match changed.kind {
            Change::New => IncrementalFoldResult::NewMessage(Cow::Borrowed(message)),
            Change::Updated => IncrementalFoldResult::MessageUpdate(Cow::Borrowed(message)),
        }
    }
}

/// How one push changed [`State::messages`].
#[derive(Debug, Clone, Copy)]
struct Changed {
    kind: Change,
    /// The changed message's index in [`State::messages`].
    message: usize,
}

impl Changed {
    /// A message that did not exist before this push.
    fn new(message: usize) -> Self {
        Self {
            kind: Change::New,
            message,
        }
    }

    /// A message already reported, now carrying more.
    fn updated(message: usize) -> Self {
        Self {
            kind: Change::Updated,
            message,
        }
    }
}

/// Whether a changed message is one the caller has seen before.
#[derive(Debug, Clone, Copy)]
enum Change {
    New,
    Updated,
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

    async fn next_turn_id(&self, session: AgentSessionId) -> Result<TurnId, rootcause::Report> {
        let log = self.list_by_session(session).await?;
        Ok(fold_machine(log).next_turn_id())
    }
}

/// The fold's state, advanced one log entry at a time by [`State::step`] and
/// owned by [`FoldMachineImpl`].
#[derive(Debug, Default)]
struct FoldState {
    /// Every message derived so far, oldest first - including the open turn's
    /// agent message, which is appended to in place as the agent talks.
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
///
/// Holds no content of its own. The turn's agent message lives in
/// [`State::messages`] as soon as there is one, and everything here is a way
/// back into it.
#[derive(Debug)]
struct Turn {
    id: TurnId,
    /// The `session/prompt` request whose response will close this turn.
    ///
    /// `None` for a turn opened without one - see
    /// [`State::begin_turn_without_prompt`]. Such a turn has no id to
    /// correlate against, so [`State::end_turn`] closes it on the first
    /// response that reports a stop reason instead.
    prompt_id: Option<RequestId>,
    /// Where this turn's agent message sits in [`State::messages`].
    ///
    /// `None` until the agent produces its first part, because a
    /// [`FoldedMessage`] cannot hold an empty part list - which is also what
    /// makes a turn the agent never answered derive no agent message at all.
    agent: Option<usize>,
    /// Where each tool call sits in the agent message's parts, so patches can
    /// find it.
    tool_positions: HashMap<ToolUseId, usize>,
    /// Where each permission sits in the agent message's parts, so outcomes
    /// can find it.
    permission_positions: HashMap<ToolUseId, usize>,
}

impl FoldState {
    /// Advance by one log entry, returning the message it changed.
    ///
    /// One entry changes at most one message - see [`IncrementalFoldResult`]
    /// for why the prompt-interrupts-a-turn case is not an exception.
    fn step(&mut self, entry: AgentSessionLog) -> Option<Changed> {
        self.session = Some(entry.agent_session_id);

        // The one place the protocol is dispatched. Each arm names a frame
        // this fold understands; the rest are ignored on purpose.
        match &entry.content {
            Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => match &acp.0 {
                // A user's prompt opens a turn.
                RawJsonRpcMessage::Request(request)
                    if PromptRequest::matches_method(&request.method) =>
                {
                    self.begin_turn(&request.id, request.params.as_ref(), entry.user_id.clone())
                }
                // The user's answer to a permission request.
                RawJsonRpcMessage::Response(Response::Result { id, result }) => {
                    self.resolve_permission(id, Some(result))
                }
                RawJsonRpcMessage::Response(Response::Error { id, .. }) => {
                    self.resolve_permission(id, None)
                }
                // Handshake and configuration traffic: nothing to render.
                RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => None,
            },

            Message::ToServer(ToServerMessage::Acp(acp)) => match &acp.0 {
                // The bulk of the log: streamed content and tool activity.
                RawJsonRpcMessage::Notification(notification)
                    if SessionNotification::matches_method(&notification.method) =>
                {
                    self.apply_session_update(notification.params.as_ref())
                }
                // The agent asking to proceed.
                RawJsonRpcMessage::Request(request)
                    if RequestPermissionRequest::matches_method(&request.method) =>
                {
                    self.request_permission(&request.id, request.params.as_ref())
                }
                // The response to `session/prompt` closes the turn.
                RawJsonRpcMessage::Response(Response::Result { id, result }) => {
                    self.end_turn(id, Some(result))
                }
                RawJsonRpcMessage::Response(Response::Error { id, .. }) => self.end_turn(id, None),
                RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => None,
            },

            // Runtime lifecycle events carry no conversation content. The one
            // the service acts on, `acp_ready`, is a handshake signal.
            Message::ToServer(ToServerMessage::Event { .. }) => None,

            // The wrapped protocol enums are `#[non_exhaustive]`.
            Message::ToServer(_) | Message::ToRuntime(_) => None,
        }
    }

    /// Handle a `session/prompt`: emit the user's message, open a turn.
    fn begin_turn(
        &mut self,
        prompt_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        // A second prompt without an intervening response means the previous
        // turn never got one. Its agent message is already in `messages` and
        // already reads `stop: None`, so there is nothing left to report -
        // which is what keeps a push to one changed message.
        let closed = self.close_turn(None);
        debug_assert!(
            closed.is_none(),
            "closing a turn without a stop reason changes nothing"
        );

        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;

        // A params shape this fold does not recognize derives no text, same
        // as an empty prompt - see the module docs on why a mismatch here
        // degrades rather than warns: `PromptRequest`'s own fields (a session
        // id, an optional `_meta`) carry nothing this fold renders, so there
        // is nothing to warn *about* beyond "no text," which showing no user
        // message already says.
        let text = deserialize_params::<PromptRequest>(params)
            .map(|request| {
                request
                    .prompt
                    .into_iter()
                    .filter_map(content_block_text)
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();

        // A prompt carrying no text derives no user message, but still opens
        // the turn the agent will answer into.
        let changed = (!text.is_empty()).then(|| {
            let message = self.messages.len();
            self.messages.push(FoldedMessage {
                id,
                author: Author::User(user_id),
                parts: NonEmpty::one(MessagePart::Text(text)),
                stop: None,
            });
            Changed::new(message)
        });

        self.turn = Some(Turn {
            id,
            prompt_id: Some(prompt_id.clone()),
            agent: None,
            tool_positions: HashMap::new(),
            permission_positions: HashMap::new(),
        });

        changed
    }

    /// Handle the response to `session/prompt`: close the turn.
    fn end_turn(
        &mut self,
        response_id: &RequestId,
        value: Option<&serde_json::Value>,
    ) -> Option<Changed> {
        let stop = value
            .and_then(|value| value.get("stopReason"))
            .and_then(|reason| reason.as_str())
            // Infallible: `StopReason`'s unmodelled variant is strum's default.
            .and_then(|reason| reason.parse().ok());

        let closes_the_open_turn = match self.turn.as_ref() {
            Some(turn) => match &turn.prompt_id {
                // The ordinary case: the response to the prompt that opened it.
                Some(prompt_id) => prompt_id == response_id,
                // A turn nothing prompted has no id to match against, so the
                // first response reporting a stop reason is taken as its
                // answer - the prompt it belongs to is in an earlier log.
                None => stop.is_some(),
            },
            None => false,
        };

        if !closes_the_open_turn {
            // Responses to `initialize`, `session/new` and `session/load`
            // land here. Only flag one that looks like a turn ending.
            if stop.is_some() {
                self.warn(FoldError::UncorrelatedResponse);
            }
            return None;
        }

        self.close_turn(stop)
    }

    /// Handle a `session/update`.
    fn apply_session_update(&mut self, params: Option<&RawJsonRpcParams>) -> Option<Changed> {
        // Only the `update` field is folded; the rest of the notification
        // (session id, meta) carries nothing renderable. Borrowed out of the
        // params rather than cloning them - `session/update` is the bulk of
        // any log, so this is the fold's hot path.
        let Some(update_value) = param(params, "update") else {
            self.warn(FoldError::Unknown {
                kind: "<missing params>".to_owned(),
            });
            return None;
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
            return None;
        };

        match update {
            // Prose from the agent. Chunks are appended to the open text part
            // rather than each becoming a part of its own.
            SessionUpdate::AgentMessageChunk(chunk) => {
                content_block_text(chunk.content).and_then(|text| self.append_text(text))
            }
            // Reasoning, kept separate so a reader can collapse it.
            SessionUpdate::AgentThoughtChunk(chunk) => {
                content_block_text(chunk.content).and_then(|text| self.append_thought(text))
            }
            // The agent replaying the user's own message. The prompt frame is
            // the authoritative copy, so this is dropped.
            SessionUpdate::UserMessageChunk(_) => None,
            SessionUpdate::ToolCall(call) => self.open_tool_call(call),
            SessionUpdate::ToolCallUpdate(update) => self.patch_tool_call(update),
            // Deliberately dropped: token accounting and session bookkeeping,
            // none of which a reader wants in a channel. `usage_update` alone
            // is 81 of ~450 frames in a recorded session.
            SessionUpdate::UsageUpdate(_)
            | SessionUpdate::SessionInfoUpdate(_)
            | SessionUpdate::AvailableCommandsUpdate(_)
            | SessionUpdate::CurrentModeUpdate(_)
            | SessionUpdate::ConfigOptionUpdate(_) => None,
            // Plans are renderable and worth folding, but no recorded session
            // has produced one yet, so there is nothing to verify a shape
            // against. Logged rather than guessed at.
            SessionUpdate::Plan(_) => {
                self.warn(FoldError::Unknown { kind: wire_kind });
                None
            }
            _ => {
                self.warn(FoldError::Unknown { kind: wire_kind });
                None
            }
        }
    }

    /// Handle a `tool_call`: add a new tool part.
    fn open_tool_call(&mut self, call: ToolCall) -> Option<Changed> {
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

        // A repeated open for the same id patches in place rather than
        // duplicating the row. Looked up without `?` so that a call arriving
        // with no turn open falls through to `push_agent_part`, which opens
        // one, rather than being dropped.
        let opened = self
            .turn
            .as_ref()
            .and_then(|turn| turn.tool_positions.get(&id).copied());
        if let Some(position) = opened {
            let (message, parts) = self.agent_parts_mut()?;
            if let Some(MessagePart::ToolUse(existing)) = parts.get_mut(position) {
                *existing = tool;
            }
            return Some(Changed::updated(message));
        }

        let (changed, position) = self.push_agent_part(MessagePart::ToolUse(tool))?;
        self.open_turn().tool_positions.insert(id, position);
        Some(changed)
    }

    /// Handle a `tool_call_update`: patch an existing tool part.
    ///
    /// Only fields the update actually carries are written, since
    /// `ToolCallUpdateFields` is entirely optional and a typical call is
    /// patched several times - the recordings average about four updates per
    /// call.
    fn patch_tool_call(&mut self, update: ToolCallUpdate) -> Option<Changed> {
        let id = ToolUseId(update.tool_call_id.0.to_string());

        let Some(&position) = self.turn.as_ref()?.tool_positions.get(&id) else {
            self.warn(FoldError::PatchBeforeOpen { tool_call: id });
            return None;
        };
        let (message, parts) = self.agent_parts_mut()?;
        let Some(MessagePart::ToolUse(tool)) = parts.get_mut(position) else {
            return None;
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

        Some(Changed::updated(message))
    }

    /// Handle a `session/request_permission`: add a permission part and record
    /// the request id so its response can be matched.
    fn request_permission(
        &mut self,
        request_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
    ) -> Option<Changed> {
        let request = deserialize_params::<RequestPermissionRequest>(params)?;
        let tool_call = ToolUseId(request.tool_call.tool_call_id.0.to_string());
        let options = request
            .options
            .into_iter()
            .map(|option| PermissionOption {
                id: option.option_id.0.to_string(),
                name: option.name,
                kind: permission_option_kind(option.kind),
            })
            .collect();

        // Recorded even with no turn open, so a late response is still
        // recognized as an answer rather than an uncorrelated frame.
        self.pending_permissions
            .insert(request_id.clone(), tool_call.clone());

        let (changed, position) = self.push_agent_part(MessagePart::Permission(Permission {
            tool_call: tool_call.clone(),
            options,
            outcome: PermissionOutcome::Pending,
        }))?;
        self.open_turn()
            .permission_positions
            .insert(tool_call, position);
        Some(changed)
    }

    /// Handle the response to a permission request.
    fn resolve_permission(
        &mut self,
        response_id: &RequestId,
        value: Option<&serde_json::Value>,
    ) -> Option<Changed> {
        let tool_call = self.pending_permissions.remove(response_id)?;

        let outcome = match value {
            // A JSON-RPC error, not a result: the harness failed to answer
            // rather than resolving the request.
            None => PermissionOutcome::Errored,
            Some(value) => {
                match serde_json::from_value::<RequestPermissionResponse>(value.clone()) {
                    Ok(response) => match response.outcome {
                        RequestPermissionOutcome::Selected(selected) => {
                            PermissionOutcome::Selected {
                                option_id: selected.option_id.0.to_string(),
                            }
                        }
                        RequestPermissionOutcome::Cancelled => PermissionOutcome::Cancelled,
                        // `#[non_exhaustive]`; reaching this means ACP added
                        // an outcome after this was written.
                        _ => PermissionOutcome::Unrecognized,
                    },
                    // The result did not match ACP's response shape.
                    Err(_) => PermissionOutcome::Unrecognized,
                }
            }
        };

        let position = *self.turn.as_ref()?.permission_positions.get(&tool_call)?;
        let (message, parts) = self.agent_parts_mut()?;
        if let Some(MessagePart::Permission(permission)) = parts.get_mut(position) {
            permission.outcome = outcome;
        }
        Some(Changed::updated(message))
    }

    /// Append agent prose, extending the trailing text part when there is one.
    fn append_text(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Text(existing) = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Text(text))
            .map(|(changed, _)| changed)
    }

    /// Append agent reasoning, extending the trailing thought part when there
    /// is one.
    fn append_thought(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Thought(existing) = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Thought(text))
            .map(|(changed, _)| changed)
    }

    /// Close the open turn, recording on its agent message how it stopped.
    ///
    /// Unlike the batch fold this replaces, closing does not emit the agent
    /// message - it has been in [`State::messages`] since the agent's first
    /// part. All that is left is the stop reason, so a turn that stopped for
    /// no stated reason, or that the agent never answered, changes nothing.
    fn close_turn(&mut self, stop: Option<StopReason>) -> Option<Changed> {
        let turn = self.turn.take()?;
        let message = turn.agent?;
        self.messages[message].stop = Some(stop?);
        Some(Changed::updated(message))
    }

    /// Add a part to the open turn's agent message, creating that message if
    /// this is the first part the agent has produced in the turn - and the
    /// turn itself if the agent is talking without one.
    ///
    /// Every way the agent contributes content comes through here, which is
    /// why opening the turn belongs here rather than in each caller.
    fn push_agent_part(&mut self, part: MessagePart) -> Option<(Changed, usize)> {
        if self.turn.is_none() {
            self.begin_turn_without_prompt();
        }
        let turn = self.turn.as_ref()?;
        let turn_id = turn.id;
        let agent = turn.agent;

        let Some(message) = agent else {
            let message = self.messages.len();
            self.messages.push(FoldedMessage {
                id: turn_id,
                author: Author::Agent,
                parts: NonEmpty::one(part),
                stop: None,
            });
            self.open_turn().agent = Some(message);
            return Some((Changed::new(message), 0));
        };

        let parts = &mut self.messages[message].parts;
        let position = parts.len();
        parts.push(part);
        Some((Changed::updated(message), position))
    }

    /// The open turn's agent message: where it sits in [`State::messages`],
    /// and its parts. `None` until the agent has produced a part.
    fn agent_parts_mut(&mut self) -> Option<(usize, &mut NonEmpty<Vec<MessagePart>>)> {
        let message = self.turn.as_ref()?.agent?;
        Some((message, &mut self.messages[message].parts))
    }

    /// Open a turn for agent content that arrived without a prompt.
    ///
    /// A session resumed through `session/load` picks up mid-conversation: the
    /// prompt the agent is answering is in the log of the session it resumed,
    /// not this one. Dropping the content for want of a prompt folded such a
    /// session to nothing at all - hundreds of frames of real work rendering
    /// as an empty channel - and showing the reply without the question is
    /// plainly better than showing neither.
    ///
    /// The turn is numbered like any other and produces no user message, since
    /// there is no prompt to attribute one to. It is closed by the first
    /// response carrying a stop reason; see [`State::end_turn`].
    fn begin_turn_without_prompt(&mut self) {
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;

        self.turn = Some(Turn {
            id,
            prompt_id: None,
            agent: None,
            tool_positions: HashMap::new(),
            permission_positions: HashMap::new(),
        });
    }

    /// The open turn, for the handlers that have already established there is
    /// one.
    fn open_turn(&mut self) -> &mut Turn {
        self.turn.as_mut().expect("a turn is open")
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

fn permission_option_kind(
    kind: agent_client_protocol::schema::v1::PermissionOptionKind,
) -> PermissionOptionKind {
    use agent_client_protocol::schema::v1::PermissionOptionKind as Acp;
    match kind {
        Acp::AllowOnce => PermissionOptionKind::AllowOnce,
        Acp::AllowAlways => PermissionOptionKind::AllowAlways,
        Acp::RejectOnce => PermissionOptionKind::RejectOnce,
        Acp::RejectAlways => PermissionOptionKind::RejectAlways,
        // `#[non_exhaustive]`, and unreachable in practice: this only ever
        // runs on a `kind` that already deserialized successfully, and a
        // wire value ACP added after this was written would have failed
        // that deserialize instead of reaching here - see the type's docs.
        _ => PermissionOptionKind::RejectOnce,
    }
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

/// A named JSON-RPC param, borrowed. `None` for positional params - every
/// frame this fold reads carries an object.
///
/// Only [`State::apply_session_update`] still uses this, to reach the one
/// field it wants (`update`) without paying to deserialize the rest of the
/// notification - `session/update` is most of any log, so that is the
/// difference between one clone per log and one clone per frame. Everywhere
/// else, [`deserialize_params`] reads the whole params object as ACP's own
/// type, because those frames are rare enough that the clone is free and the
/// typed struct is far harder to get wrong than a chain of `.get(key)`s.
fn param<'params>(
    params: Option<&'params RawJsonRpcParams>,
    key: &str,
) -> Option<&'params serde_json::Value> {
    match params? {
        RawJsonRpcParams::Object(map) => map.get(key),
        RawJsonRpcParams::Array(_) => None,
    }
}

/// Deserialize a request's or notification's params as a specific ACP type.
///
/// `None` for positional params (nothing this fold reads uses those) or when
/// the object does not match `T`'s shape - the crate's total-by-construction
/// design point: a mismatch here is a state to render around, not a reason
/// to fail. Callers that want that mismatch to warn do so themselves; most
/// do not, because the alternative to a malformed prompt or permission
/// request is simply deriving less from it, same as any other partial frame.
fn deserialize_params<T: serde::de::DeserializeOwned>(
    params: Option<&RawJsonRpcParams>,
) -> Option<T> {
    match params? {
        RawJsonRpcParams::Object(map) => {
            serde_json::from_value(serde_json::Value::Object(map.clone())).ok()
        }
        RawJsonRpcParams::Array(_) => None,
    }
}
