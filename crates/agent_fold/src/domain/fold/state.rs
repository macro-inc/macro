//! The fold's state and the one place the protocol is dispatched.

use std::collections::{HashMap, HashSet};

use crate::domain::error::FoldError;
use crate::domain::harness::{HarnessReader, ToolFrame};
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::model::{Control, FoldedMessage, SessionMetadata, ToolUseId, TurnId};
use agent_client_protocol::schema::v1::{
    PromptRequest, RequestId, RequestPermissionRequest, Response, SessionNotification,
    SessionUpdate,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use serde::Deserialize;

use super::convert::{content_block_text, param};

/// How one push changed [`State::messages`].
#[derive(Debug, Clone, Copy)]
pub(super) struct Changed {
    pub(super) kind: Change,
    /// The changed message's index in [`State::messages`].
    pub(super) message: usize,
}

impl Changed {
    /// A message that did not exist before this push.
    pub(super) fn new(message: usize) -> Self {
        Self {
            kind: Change::New,
            message,
        }
    }

    /// A message already reported, now carrying more.
    pub(super) fn updated(message: usize) -> Self {
        Self {
            kind: Change::Updated,
            message,
        }
    }
}

/// Whether a changed message is one the caller has seen before.
#[derive(Debug, Clone, Copy)]
pub(super) enum Change {
    New,
    Updated,
}

/// One change a step implied. A step returns however many it implied, in
/// emission order - most frames imply none, and the set-model response
/// implies two (its control's outcome, and the config it restates).
#[derive(Debug, Clone, Copy)]
pub(super) enum StepChange {
    Message(Changed),
    Metadata,
}

impl StepChange {
    /// The changes for a handler that touched at most one message.
    pub(super) fn message(changed: Option<Changed>) -> Vec<Self> {
        changed.map(Self::Message).into_iter().collect()
    }

    /// The changes for a handler that reported whether the metadata moved.
    pub(super) fn metadata(changed: bool) -> Vec<Self> {
        changed.then_some(Self::Metadata).into_iter().collect()
    }
}

/// The fold's state, advanced one log entry at a time by [`State::step`] and
/// owned by [`FoldMachineImpl`].
#[derive(Debug, Default)]
pub(super) struct FoldState {
    /// Every message derived so far, oldest first - including the open turn's
    /// agent message, which is appended to in place as the agent talks.
    pub(super) messages: Vec<FoldedMessage>,
    /// The session the entry currently being folded belongs to, for
    /// [`State::warn`]. Set fresh from each log entry, so it is always
    /// current even though it rarely changes within one fold.
    pub(super) session: Option<AgentSessionId>,
    /// The turn currently being built, if any.
    pub(super) turn: Option<Turn>,
    /// Where every tool call so far sits, so a patch can find it.
    ///
    /// Session-wide, not per turn: a user tool is patched *after* its turn
    /// ended, when the user edits or sends the draft, and a subagent's calls
    /// nest inside their parent. ACP tool call ids are unique within a
    /// session, which is what makes one map sound.
    pub(super) tool_positions: HashMap<ToolUseId, ToolPath>,
    /// How many turns have been opened, which is also the next [`TurnId`].
    pub(super) turns_opened: u32,
    /// Outstanding permission requests, by the id of the request that asked.
    pub(super) pending_permissions: HashMap<RequestId, ToolUseId>,
    /// Session-level state derived so far. Handlers mutate it freely; the
    /// machine diffs it against what it last reported.
    pub(super) metadata: SessionMetadata,
    /// The `initialize` request whose response will name the harness.
    pub(super) pending_initialize: Option<RequestId>,
    /// Requests whose responses carry config options. The response body is
    /// authoritative - a rejected change answers with an error and moves
    /// nothing.
    pub(super) pending_config_requests: HashSet<RequestId>,
    /// Controls awaiting a response, by request id: where the control part
    /// sits (message, part), so the response can resolve its outcome.
    pub(super) pending_controls: HashMap<RequestId, (usize, usize)>,
}

/// Where a tool call's part sits: which message, and the path of part
/// indices to it - one index for a top-level part, more for one nested
/// inside another part's children.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ToolPath {
    /// Index into [`FoldState::messages`].
    pub(super) message: usize,
    /// Part indices from the message's parts down to the tool's part.
    pub(super) path: Vec<usize>,
}

/// A turn under construction.
///
/// Holds no content of its own. The turn's agent message lives in
/// [`State::messages`] as soon as there is one, and everything here is a way
/// back into it.
#[derive(Debug)]
pub(super) struct Turn {
    pub(super) id: TurnId,
    /// The `session/prompt` request whose response will close this turn.
    ///
    /// `None` for a turn opened without one - see
    /// [`State::begin_turn_without_prompt`]. Such a turn has no id to
    /// correlate against, so [`State::end_turn`] closes it on the first
    /// response that reports a stop reason instead.
    pub(super) prompt_id: Option<RequestId>,
    /// Where this turn's agent message sits in [`State::messages`].
    ///
    /// `None` until the agent produces its first part, because a
    /// [`FoldedMessage`] cannot hold an empty part list - which is also what
    /// makes a turn the agent never answered derive no agent message at all.
    pub(super) agent: Option<usize>,
    /// Where each permission sits in the agent message's parts, so outcomes
    /// can find it.
    pub(super) permission_positions: HashMap<ToolUseId, usize>,
    /// Where this turn's plan sits in the agent message's parts, so later
    /// plan updates can replace it.
    pub(super) plan_position: Option<usize>,
    /// Whether closing this turn needs an agent message to record its stop
    /// reason on, minting one if the agent never produced a part.
    ///
    /// True for a turn a prompt opened: the user's bubble is then the
    /// transcript's newest turn message, and readers take one without a stop
    /// reason to mean the agent is still working. False for a turn a control
    /// opened (`/compact`), whose own message readers skip.
    pub(super) expects_reply: bool,
}

impl FoldState {
    /// Advance by one log entry, returning what it changed in emission order.
    ///
    /// One entry changes at most one message today - see [`FoldEvent`]
    /// for why the prompt-interrupts-a-turn case is not an exception.
    pub(super) fn step(&mut self, entry: AgentSessionLog) -> Vec<StepChange> {
        self.session = Some(entry.agent_session_id);

        // The one place the protocol is dispatched. Each arm names a frame
        // this fold understands; the rest are ignored on purpose.
        match &entry.content {
            Message::ToRuntime(message @ ToRuntimeMessage::Acp(acp)) => {
                // Before the control dispatch, which returns early for the
                // set-model request whose response this correlates.
                self.note_config_request(&acp.0);
                self.note_initialize_request(&acp.0);
                if let Some(action) = AgentAction::control_from_runtime(message) {
                    return StepChange::message(match action {
                        AgentAction::SetModel(action) => {
                            let request_id = match &acp.0 {
                                RawJsonRpcMessage::Request(request) => Some(&request.id),
                                _ => None,
                            };
                            self.record_control(
                                Control::SetModel {
                                    model: action.model,
                                },
                                request_id,
                                entry.user_id.clone(),
                            )
                        }
                        AgentAction::Compact => match &acp.0 {
                            RawJsonRpcMessage::Request(request) => {
                                self.begin_compact(&request.id, entry.user_id.clone())
                            }
                            _ => None,
                        },
                        // A stop is a notification: nothing can answer it, so
                        // it is accepted the moment it is sent.
                        AgentAction::Stop => {
                            self.record_control(Control::Stop, None, entry.user_id.clone())
                        }
                        AgentAction::Prompt(_) => None,
                    });
                }
                StepChange::message(match &acp.0 {
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
                })
            }

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
                    StepChange::message(
                        self.request_permission(&request.id, request.params.as_ref()),
                    )
                }
                // The response to `session/prompt` closes the turn; a
                // config-bearing response updates the metadata; a control's
                // response resolves its outcome. Set-model is both of the
                // latter at once.
                RawJsonRpcMessage::Response(Response::Result { id, result }) => {
                    if self.pending_initialize.as_ref() == Some(id) {
                        self.pending_initialize = None;
                        return StepChange::metadata(self.apply_initialize_response(result));
                    }
                    let control = self.resolve_control(id, None);
                    if self.pending_config_requests.remove(id) {
                        let mut changes = StepChange::message(control);
                        changes.extend(StepChange::metadata(self.apply_config_response(result)));
                        changes
                    } else if control.is_some() {
                        StepChange::message(control)
                    } else {
                        StepChange::message(self.end_turn(id, Some(result)))
                    }
                }
                RawJsonRpcMessage::Response(Response::Error { id, error }) => {
                    let control = self.resolve_control(id, Some(&error.message));
                    // An error response moves no metadata, so a config-bearing
                    // request's failure changes at most its control part.
                    if self.pending_config_requests.remove(id) || control.is_some() {
                        StepChange::message(control)
                    } else {
                        StepChange::message(self.fail_turn(id, &error.message))
                    }
                }
                RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => Vec::new(),
            },

            // Runtime lifecycle events carry no conversation content, but
            // they are the session's status, and `acp_ready` marks a
            // connection boundary: request ids restart per connection, so
            // nothing pending can be answered past one - a stale entry would
            // misattribute a new connection's reused id.
            Message::ToServer(ToServerMessage::Event { event }) => {
                if matches!(event, SystemEvent::AcpReady) {
                    self.pending_initialize = None;
                    self.pending_config_requests.clear();
                    self.pending_permissions.clear();
                    self.pending_controls.clear();
                }
                let status = Some(event.as_str().to_owned());
                let changed = self.metadata.status != status;
                if changed {
                    self.metadata.status = status;
                }
                StepChange::metadata(changed)
            }

            // The wrapped protocol enums are `#[non_exhaustive]`.
            Message::ToServer(_) | Message::ToRuntime(_) => Vec::new(),
        }
    }

    /// Handle a `session/update`.
    pub(super) fn apply_session_update(
        &mut self,
        params: Option<&RawJsonRpcParams>,
    ) -> Vec<StepChange> {
        // Only the `update` field is folded; the rest of the notification
        // (session id, meta) carries nothing renderable. Borrowed out of the
        // params rather than cloning them - `session/update` is the bulk of
        // any log, so this is the fold's hot path.
        let Some(update_value) = param(params, "update") else {
            self.warn(FoldError::Unknown {
                kind: "<missing params>".to_owned(),
            });
            return Vec::new();
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
            return Vec::new();
        };

        match update {
            // Prose from the agent. Chunks are appended to the open text part
            // rather than each becoming a part of its own.
            SessionUpdate::AgentMessageChunk(chunk) => StepChange::message(
                content_block_text(chunk.content).and_then(|text| self.append_text(text)),
            ),
            // Reasoning, kept separate so a reader can collapse it.
            SessionUpdate::AgentThoughtChunk(chunk) => StepChange::message(
                content_block_text(chunk.content).and_then(|text| self.append_thought(text)),
            ),
            // The agent replaying the user's own message. The prompt frame is
            // the authoritative copy, so this is dropped.
            SessionUpdate::UserMessageChunk(_) => Vec::new(),
            SessionUpdate::ToolCall(call) => {
                let mut changes =
                    StepChange::metadata(self.sniff_harness(&ToolFrame::of_call(&call)));
                changes.extend(StepChange::message(self.open_tool_call(call)));
                changes
            }
            SessionUpdate::ToolCallUpdate(update) => {
                let mut changes =
                    StepChange::metadata(self.sniff_harness(&ToolFrame::of_update(&update)));
                changes.extend(StepChange::message(self.patch_tool_call(update)));
                changes
            }
            SessionUpdate::SessionInfoUpdate(update) => {
                StepChange::metadata(self.apply_session_info(&update))
            }
            SessionUpdate::ConfigOptionUpdate(update) => {
                StepChange::metadata(self.apply_config_options(update.config_options))
            }
            SessionUpdate::AvailableCommandsUpdate(update) => {
                StepChange::metadata(self.apply_available_commands(update))
            }
            // Deliberately dropped: token accounting and session bookkeeping,
            // none of which a reader wants in a channel. `usage_update` alone
            // is 81 of ~450 frames in a recorded session.
            SessionUpdate::UsageUpdate(_) | SessionUpdate::CurrentModeUpdate(_) => Vec::new(),
            // The agent's todo list, carried whole each time.
            SessionUpdate::Plan(plan) => StepChange::message(self.apply_plan(plan)),
            _ => {
                self.warn(FoldError::Unknown { kind: wire_kind });
                Vec::new()
            }
        }
    }

    /// How to read the frames of whichever harness produced this log.
    pub(super) fn reader(&self) -> &'static dyn HarnessReader {
        self.metadata.harness.reader()
    }

    /// The open turn, for the handlers that have already established there is
    /// one.
    pub(super) fn open_turn(&mut self) -> &mut Turn {
        self.turn.as_mut().expect("a turn is open")
    }

    /// Log a frame the fold could not account for. Not fatal - see the
    /// module docs - so this only ever logs and never returns an error.
    pub(super) fn warn(&self, error: FoldError) {
        tracing::warn!(
            session = ?self.session,
            error = ?error,
            "agent session log frame could not be folded"
        );
    }
}
