//! The fold's state and the one place the protocol is dispatched.

use std::collections::{HashMap, HashSet};

use crate::domain::error::FoldError;
use crate::domain::harness::{HarnessReader, ToolFrame};
use agent_client_protocol::schema::v1::SessionId;

use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::model::{Control, FoldedMessage, SessionMetadata, ToolUseId, TurnId, TurnState};
use agent_client_protocol::schema::v1::{
    CompleteElicitationNotification, CreateElicitationRequest, PromptRequest, RequestId,
    RequestPermissionRequest, Response, SessionNotification, SessionUpdate,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use serde::Deserialize;

use super::convert::{content_block_text, param, user_content_part};

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

impl FoldState {
    /// The changes for a handler that touched one message and reported
    /// whether the metadata moved, message first.
    fn message_and_metadata(changed: Changed, metadata: bool) -> Vec<StepChange> {
        let mut changes = vec![StepChange::Message(changed)];
        changes.extend(StepChange::metadata(metadata));
        changes
    }
}

/// The fold's state, advanced one log entry at a time by [`State::step`] and
/// owned by [`FoldMachineImpl`].
#[derive(Debug, Clone, Default)]
pub(super) struct FoldState {
    /// Every message derived so far, oldest first - including the open turn's
    /// agent message, which is appended to in place as the agent talks.
    pub(super) messages: Vec<FoldedMessage>,
    /// User notifications are authoritative only inside a staged load.
    pub(super) replaying: bool,
    /// The frame being stepped is one this client caused but the log has not
    /// confirmed. Every message it derives is marked pending. Set for one
    /// step by [`FoldMachineImpl::push_speculative`].
    pub(super) speculative: bool,
    /// The ACP session id the runtime answers to, from the request that
    /// opened it or any prompt addressed to it. See
    /// [`FoldMachineImpl::acp_session_id`].
    pub(super) acp_session: Option<SessionId>,
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
    pub(super) pending_permissions: HashMap<RequestId, ToolPath>,
    /// Outstanding `elicitation/create`s, by the id of the request that
    /// asked: where the question's part sits, so its answer can find it.
    /// Session-wide like [`Self::tool_positions`], since the part may have
    /// taken a tool call's place under a subagent.
    pub(super) pending_elicitations: HashMap<RequestId, ToolPath>,
    /// Accepted URL elicitations the agent may still report complete, by the
    /// agent's `elicitationId`.
    pub(super) completable_elicitations: HashMap<String, ToolPath>,
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
#[derive(Debug, Clone)]
pub(super) struct Turn {
    pub(super) id: TurnId,
    /// The prompt that opened this turn is speculative: on the wire, not yet
    /// in the log. Reads as [`TurnState::Starting`] until the agent answers.
    pub(super) prompt_pending: bool,
    /// A stop was issued against this turn and no stop reason has arrived.
    /// Reads as [`TurnState::Stopping`].
    pub(super) stop_requested: bool,
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
    /// Forget request correlations at a connection boundary without clearing history.
    pub(super) fn clear_pending(&mut self) {
        self.pending_initialize = None;
        self.pending_config_requests.clear();
        self.forget_interactions();
        self.pending_controls.clear();
        self.close_turn(None);
    }

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
                        // it is accepted the moment it is sent. The turn it
                        // interrupts ends through the agent's own stop event.
                        AgentAction::Stop => {
                            if let Some(turn) = &mut self.turn {
                                turn.stop_requested = true;
                            }
                            self.record_control(Control::Stop, None, entry.user_id.clone())
                        }
                        // `control_from_runtime` never yields these: a prompt
                        // is folded below, and an elicitation answer is a
                        // response frame, correlated by the agent's id.
                        AgentAction::Prompt(_)
                        | AgentAction::RespondElicitation(_)
                        | AgentAction::RespondToPermission(_) => None,
                    });
                }
                // A user's prompt opens a turn - and may close the one
                // before it, so it reports on its own.
                if let RawJsonRpcMessage::Request(request) = &acp.0
                    && PromptRequest::matches_method(&request.method)
                {
                    return self
                        .begin_turn(&request.id, request.params.as_ref(), entry.user_id.clone())
                        .into_iter()
                        .map(StepChange::Message)
                        .collect();
                }
                let changed = match &acp.0 {
                    // Both responses correlate by the agent's request id;
                    // each decoder retains its own answer semantics.
                    RawJsonRpcMessage::Response(Response::Result { id, result }) => self
                        .resolve_elicitation(id, Some(result), None)
                        .or_else(|| self.resolve_permission(id, Some(result))),
                    RawJsonRpcMessage::Response(Response::Error { id, error }) => self
                        .resolve_elicitation(id, None, Some(&error.message))
                        .or_else(|| self.resolve_permission(id, None)),
                    RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => None,
                };
                changed.map_or_else(Vec::new, |(message, metadata)| {
                    Self::message_and_metadata(message, metadata)
                })
            }

            Message::ToServer(ToServerMessage::Acp(acp)) => match &acp.0 {
                RawJsonRpcMessage::Notification(notification)
                    if notification.method.as_ref() == "_session/turn_complete" =>
                {
                    use agent_runtime_protocol::domain::turn::{
                        TurnCompleteNotification, TurnOutcome,
                    };
                    // A real pending prompt completes only through its correlated
                    // response. Historical facts may finish replay or an unprompted
                    // continuation, never an unrelated pending user request.
                    if !self.replaying
                        && self
                            .turn
                            .as_ref()
                            .is_some_and(|turn| turn.prompt_id.is_some())
                    {
                        return Vec::new();
                    }
                    let stop = super::convert::deserialize_params::<TurnCompleteNotification>(
                        notification.params.as_ref(),
                    )
                    .map(|fact| match fact.outcome {
                        TurnOutcome::Finished => crate::domain::model::StopReason::EndTurn,
                        TurnOutcome::Cancelled => crate::domain::model::StopReason::Cancelled,
                        TurnOutcome::Failed { message } => {
                            crate::domain::model::StopReason::Failed { message }
                        }
                    });
                    StepChange::message(stop.and_then(|stop| self.close_turn(Some(stop))))
                }
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
                    match self.request_permission(&request.id, request.params.as_ref()) {
                        Some((changed, metadata)) => Self::message_and_metadata(changed, metadata),
                        None => Vec::new(),
                    }
                }
                // The agent asking the user a question.
                RawJsonRpcMessage::Request(request)
                    if CreateElicitationRequest::matches_method(&request.method) =>
                {
                    match self.request_elicitation(&request.id, request.params.as_ref()) {
                        Some((changed, metadata)) => Self::message_and_metadata(changed, metadata),
                        None => Vec::new(),
                    }
                }
                // The agent reporting that a URL interaction finished.
                RawJsonRpcMessage::Notification(notification)
                    if CompleteElicitationNotification::matches_method(&notification.method) =>
                {
                    StepChange::message(self.complete_elicitation(notification.params.as_ref()))
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
                let mut changed = false;
                if matches!(event, SystemEvent::AcpReady) {
                    self.pending_initialize = None;
                    self.pending_config_requests.clear();
                    self.pending_controls.clear();
                    changed |= self.forget_interactions();
                }
                let status = Some(event.as_str().to_owned());
                if self.metadata.status != status {
                    self.metadata.status = status;
                    changed = true;
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
            // Replay has no original prompt requests: user chunks are its
            // authoritative prompts. Outside load, ignore prompt echoes.
            SessionUpdate::UserMessageChunk(chunk)
                if self.replaying
                    || self
                        .turn
                        .as_ref()
                        .is_none_or(|turn| turn.prompt_id.is_none()) =>
            {
                StepChange::message(
                    user_content_part(chunk.content).and_then(|part| self.replay_user_part(part)),
                )
            }
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

    /// Forget live requests at a connection boundary, preserving the transcript.
    fn forget_interactions(&mut self) -> bool {
        self.pending_permissions.clear();
        self.pending_elicitations.clear();
        self.completable_elicitations.clear();
        let changed = !self.metadata.pending_interactions.is_empty();
        self.metadata.pending_interactions.clear();
        changed
    }

    /// Recompute [`SessionMetadata::turn`] from the state, reporting whether
    /// it moved. Called once per push, after the step, because it is a
    /// projection of several things a step may touch at once.
    pub(super) fn refresh_turn_state(&mut self) -> bool {
        // A live request belongs to one turn and connection. Its transcript
        // part survives cancellation, but no surface may answer it afterwards.
        let before = self.metadata.pending_interactions.len();
        let live_turn = self
            .turn
            .as_ref()
            .filter(|turn| !turn.stop_requested)
            .map(|turn| turn.id.0);
        let disconnected =
            self.metadata.status.as_deref() == Some(SystemEvent::Disconnected.as_str());
        self.metadata
            .pending_interactions
            .retain(|pending| !disconnected && Some(pending.turn()) == live_turn);
        let interactions_changed = before != self.metadata.pending_interactions.len();
        let turn = if disconnected {
            TurnState::Disconnected
        } else {
            match &self.turn {
                None => TurnState::Idle,
                // Before `Blocked`: a user who pressed stop while the agent
                // was waiting on their answer is owed the stop, not the
                // question they just walked away from.
                Some(turn) if turn.stop_requested => TurnState::Stopping,
                Some(_) if !self.metadata.pending_interactions.is_empty() => TurnState::Blocked,
                Some(turn) if turn.prompt_pending && turn.agent.is_none() => TurnState::Starting,
                Some(_) => TurnState::Running,
            }
        };
        if self.metadata.turn == turn {
            return interactions_changed;
        }
        self.metadata.turn = turn;
        true
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
