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
use crate::domain::meta::{claude_code, command_from_raw_input, file_edit_from_raw_input};
use crate::domain::model::{
    AnsiText, Author, AvailableCommand, Control, ControlOutcome, FileDiff, FoldEvent,
    FoldedMessage, MessagePart, ModelOption, PermissionOption, PermissionOptionKind,
    PermissionOutcome, PlanEntry, PlanEntryPriority, PlanEntryStatus, SessionMetadata, StopReason,
    ToolDetail, ToolStatus, ToolUseId, TurnId,
};
use crate::domain::ports::{FoldMachine, FoldSession, LogRepo};
use agent_client_protocol::schema::MaybeUndefined;
use agent_client_protocol::schema::v1::{
    AvailableCommandInput, AvailableCommandsUpdate as AcpAvailableCommandsUpdate, Content,
    ContentBlock, LoadSessionRequest, Meta, NewSessionRequest, Plan as AcpPlan, PromptRequest,
    RequestId, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    Response, ResumeSessionRequest, SessionConfigKind, SessionConfigOption,
    SessionConfigSelectOptions, SessionInfoUpdate, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest, ToolCall, ToolCallContent, ToolCallLocation, ToolCallStatus,
    ToolCallUpdate, ToolKind,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId, MODEL_CONFIG_ID};
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
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
/// [`FoldEvent`]s borrow from. See the module docs for why the
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

    /// Session-level state derived so far, for callers that want state
    /// rather than [`FoldEvent::MetadataUpdated`] changes.
    #[must_use]
    pub fn metadata(&self) -> &SessionMetadata {
        &self.state.metadata
    }
}

impl FoldMachine for FoldMachineImpl {
    fn push(&mut self, log: AgentSessionLog) -> Vec<FoldEvent<'_>> {
        let changes = self.state.step(log);
        changes
            .into_iter()
            .filter_map(|change| match change {
                StepChange::Message(changed) => {
                    self.state
                        .messages
                        .get(changed.message)
                        .map(|message| match changed.kind {
                            Change::New => FoldEvent::NewMessage(Cow::Borrowed(message)),
                            Change::Updated => FoldEvent::MessageUpdate(Cow::Borrowed(message)),
                        })
                }
                StepChange::Metadata => Some(FoldEvent::MetadataUpdated(Cow::Borrowed(
                    &self.state.metadata,
                ))),
            })
            .collect()
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

/// One change a step implied. A step returns however many it implied, in
/// emission order - most frames imply none, and the set-model response
/// implies two (its control's outcome, and the config it restates).
#[derive(Debug, Clone, Copy)]
enum StepChange {
    Message(Changed),
    Metadata,
}

impl StepChange {
    /// The changes for a handler that touched at most one message.
    fn message(changed: Option<Changed>) -> Vec<Self> {
        changed.map(Self::Message).into_iter().collect()
    }

    /// The changes for a handler that reported whether the metadata moved.
    fn metadata(changed: bool) -> Vec<Self> {
        changed.then_some(Self::Metadata).into_iter().collect()
    }
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
    /// Session-level state derived so far. Handlers mutate it freely; the
    /// machine diffs it against what it last reported.
    metadata: SessionMetadata,
    /// Requests whose responses carry config options. The response body is
    /// authoritative - a rejected change answers with an error and moves
    /// nothing.
    pending_config_requests: HashSet<RequestId>,
    /// Controls awaiting a response, by request id: where the control part
    /// sits (message, part), so the response can resolve its outcome.
    pending_controls: HashMap<RequestId, (usize, usize)>,
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
    /// Where this turn's plan sits in the agent message's parts, so later
    /// plan updates can replace it.
    plan_position: Option<usize>,
    /// Whether closing this turn needs an agent message to record its stop
    /// reason on, minting one if the agent never produced a part.
    ///
    /// True for a turn a prompt opened: the user's bubble is then the
    /// transcript's newest turn message, and readers take one without a stop
    /// reason to mean the agent is still working. False for a turn a control
    /// opened (`/compact`), whose own message readers skip.
    expects_reply: bool,
}

impl FoldState {
    /// Advance by one log entry, returning what it changed in emission order.
    ///
    /// One entry changes at most one message today - see [`FoldEvent`]
    /// for why the prompt-interrupts-a-turn case is not an exception.
    fn step(&mut self, entry: AgentSessionLog) -> Vec<StepChange> {
        self.session = Some(entry.agent_session_id);

        // The one place the protocol is dispatched. Each arm names a frame
        // this fold understands; the rest are ignored on purpose.
        match &entry.content {
            Message::ToRuntime(message @ ToRuntimeMessage::Acp(acp)) => {
                // Before the control dispatch, which returns early for the
                // set-model request whose response this correlates.
                self.note_config_request(&acp.0);
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
                author: Author::User { user_id },
                request_id: AgentActionId::from_request_id(prompt_id),
                parts: NonEmpty::one(MessagePart::Text { text }),
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
            plan_position: None,
            expects_reply: true,
        });

        changed
    }

    /// Open a turn for a compact: the invocation renders as a control part,
    /// and how it went is the turn's own reply and stop reason, not an
    /// outcome to track separately.
    fn begin_compact(
        &mut self,
        prompt_id: &RequestId,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        let closed = self.close_turn(None);
        debug_assert!(closed.is_none());
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id,
            author: Author::User { user_id },
            request_id: AgentActionId::from_request_id(prompt_id),
            parts: NonEmpty::one(MessagePart::Control {
                control: Control::Compact,
                outcome: ControlOutcome::Accepted,
            }),
            stop: None,
        });
        self.turn = Some(Turn {
            id,
            prompt_id: Some(prompt_id.clone()),
            agent: None,
            tool_positions: HashMap::new(),
            permission_positions: HashMap::new(),
            plan_position: None,
            expects_reply: false,
        });
        Some(Changed::new(message))
    }

    /// Emit a standalone control message. A request-backed control starts
    /// pending and is resolved by its response; one with no request to answer
    /// (a stop notification) is accepted outright.
    fn record_control(
        &mut self,
        control: Control,
        request_id: Option<&RequestId>,
        user_id: Option<MacroUserIdStr<'static>>,
    ) -> Option<Changed> {
        let id = TurnId(self.turns_opened);
        self.turns_opened += 1;
        let message = self.messages.len();
        let outcome = match request_id {
            Some(_) => ControlOutcome::Pending,
            None => ControlOutcome::Accepted,
        };
        if let Some(request_id) = request_id {
            self.pending_controls
                .insert(request_id.clone(), (message, 0));
        }
        self.messages.push(FoldedMessage {
            id,
            author: Author::User { user_id },
            request_id: request_id.and_then(AgentActionId::from_request_id),
            parts: NonEmpty::one(MessagePart::Control { control, outcome }),
            stop: None,
        });
        Some(Changed::new(message))
    }

    /// Resolve a pending control from its response. `None` when the id
    /// matches no control.
    fn resolve_control(&mut self, response_id: &RequestId, error: Option<&str>) -> Option<Changed> {
        let (message, part) = self.pending_controls.remove(response_id)?;
        let Some(MessagePart::Control { outcome, .. }) =
            self.messages.get_mut(message)?.parts.get_mut(part)
        else {
            return None;
        };
        *outcome = match error {
            Some(message) => ControlOutcome::Rejected {
                message: message.to_owned(),
            },
            None => ControlOutcome::Accepted,
        };
        Some(Changed::updated(message))
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

    /// End the open turn because its prompt was answered with an error.
    ///
    /// The turn has to end even when the agent produced nothing at all -
    /// which is the common case, since a runtime that rejects a prompt
    /// rejects it before writing anything. That is why this cannot go
    /// through [`Self::close_turn`], whose job is to stamp a stop reason on
    /// an agent message that exists: here the agent message is created if
    /// need be, so the failure has somewhere to live and the turn is
    /// unambiguously over.
    fn fail_turn(&mut self, response_id: &RequestId, message: &str) -> Option<Changed> {
        let closes_the_open_turn = self
            .turn
            .as_ref()
            .and_then(|turn| turn.prompt_id.as_ref())
            .is_some_and(|prompt_id| prompt_id == response_id);
        if !closes_the_open_turn {
            return None;
        }

        // An error is worth showing under any turn, control's included, so
        // this mints unconditionally where a clean close does not.
        let turn = self.turn.take()?;
        let (agent, changed) = match turn.agent {
            Some(agent) => (agent, Changed::updated(agent)),
            None => self.mint_agent_message(turn.id),
        };
        self.messages[agent].stop = Some(StopReason::Failed {
            message: message.to_owned(),
        });
        Some(changed)
    }

    /// Handle a `session/update`.
    fn apply_session_update(&mut self, params: Option<&RawJsonRpcParams>) -> Vec<StepChange> {
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
            SessionUpdate::ToolCall(call) => StepChange::message(self.open_tool_call(call)),
            SessionUpdate::ToolCallUpdate(update) => {
                StepChange::message(self.patch_tool_call(update))
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

    /// Handle a `tool_call`: add a new tool part.
    fn open_tool_call(&mut self, call: ToolCall) -> Option<Changed> {
        let id = ToolUseId(call.tool_call_id.0.to_string());
        let label =
            claude_code::tool_name(call.meta.as_ref()).unwrap_or_else(|| call.title.clone());

        let tool = MessagePart::ToolUse {
            id: id.clone(),
            label,
            status: tool_status(call.status),
            detail: tool_detail(
                call.kind,
                call.raw_input.as_ref(),
                &call.content,
                &call.locations,
                call.meta.as_ref(),
            ),
            raw_input: call.raw_input.clone().map(Box::new),
            raw_output: call.raw_output.clone().map(Box::new),
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
            if let Some(existing @ MessagePart::ToolUse { .. }) = parts.get_mut(position) {
                *existing = tool;
            }
            return Some(Changed::updated(message));
        }

        let (changed, position) = self.push_agent_part(tool)?;
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
        let Some(MessagePart::ToolUse {
            label,
            status,
            detail,
            raw_input,
            raw_output,
            ..
        }) = parts.get_mut(position)
        else {
            return None;
        };

        let fields = update.fields;

        if let Some(new_status) = fields.status {
            *status = tool_status(new_status);
        }
        if let Some(title) = fields.title {
            // A harness-supplied name outranks any ACP title, so only take
            // the title when nothing better is already set.
            if claude_code::tool_name(update.meta.as_ref()).is_none() && label.is_empty() {
                *label = title;
            }
        }
        if let Some(name) = claude_code::tool_name(update.meta.as_ref()) {
            *label = name;
        }

        patch_detail(
            detail,
            fields.raw_input.as_ref(),
            fields.content.as_deref(),
            fields.locations.as_deref(),
            update.meta.as_ref(),
        );

        if let Some(found) = fields.raw_input {
            *raw_input = Some(Box::new(found));
        }
        if let Some(found) = fields.raw_output {
            *raw_output = Some(Box::new(found));
        }

        Some(Changed::updated(message))
    }

    /// Handle a `plan` update: the agent's todo list, carried whole each time.
    ///
    /// The first update pushes a plan part onto the turn's agent message;
    /// every later one replaces that part wholesale, which is ACP's own
    /// contract ("the client replaces the entire plan with each update"). An
    /// update identical to what the part already holds changes nothing - the
    /// harness re-emits the list more often than it changes it.
    fn apply_plan(&mut self, update: AcpPlan) -> Option<Changed> {
        let entries: Vec<PlanEntry> = update.entries.into_iter().map(plan_entry).collect();

        if let Some(position) = self.turn.as_ref().and_then(|turn| turn.plan_position) {
            let (message, parts) = self.agent_parts_mut()?;
            if let Some(MessagePart::Plan { entries: existing }) = parts.get_mut(position) {
                if *existing == entries {
                    return None;
                }
                *existing = entries;
            }
            return Some(Changed::updated(message));
        }

        // An empty list derives nothing to render, so no part is created for
        // one; the turn's first non-empty update creates it. A list that
        // *becomes* empty is a replacement like any other, handled above.
        if entries.is_empty() {
            return None;
        }

        let (changed, position) = self.push_agent_part(MessagePart::Plan { entries })?;
        self.open_turn().plan_position = Some(position);
        Some(changed)
    }

    /// Remember a request whose response will carry config options.
    fn note_config_request(&mut self, frame: &RawJsonRpcMessage) {
        let RawJsonRpcMessage::Request(request) = frame else {
            return;
        };
        let method = &request.method;
        if NewSessionRequest::matches_method(method)
            || LoadSessionRequest::matches_method(method)
            || ResumeSessionRequest::matches_method(method)
            || SetSessionConfigOptionRequest::matches_method(method)
        {
            self.pending_config_requests.insert(request.id.clone());
        }
    }

    /// Read the config options out of a correlated response, whichever
    /// response shape carried them.
    fn apply_config_response(&mut self, result: &serde_json::Value) -> bool {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ConfigCarrier {
            #[serde(default)]
            config_options: Vec<SessionConfigOption>,
        }
        match serde_json::from_value::<ConfigCarrier>(result.clone()) {
            Ok(carrier) => self.apply_config_options(carrier.config_options),
            Err(_) => false,
        }
    }

    /// Update the metadata's model fields from a fresh config-options list.
    fn apply_config_options(&mut self, options: Vec<SessionConfigOption>) -> bool {
        let model = options
            .into_iter()
            .find(|option| option.id.to_string() == MODEL_CONFIG_ID);
        let Some(SessionConfigOption {
            kind: SessionConfigKind::Select(select),
            ..
        }) = model
        else {
            return false;
        };

        let model = Some(select.current_value.to_string());
        let supported: Vec<ModelOption> = match select.options {
            SessionConfigSelectOptions::Ungrouped(options) => options,
            SessionConfigSelectOptions::Grouped(groups) => {
                groups.into_iter().flat_map(|group| group.options).collect()
            }
            _ => return false,
        }
        .into_iter()
        .map(|option| ModelOption {
            id: option.value.to_string(),
            name: option.name,
            description: option.description,
        })
        .collect();

        let changed = self.metadata.model != model || self.metadata.supported_models != supported;
        self.metadata.model = model;
        self.metadata.supported_models = supported;
        changed
    }

    /// Handle an `available_commands_update`: the advertised slash commands,
    /// carried whole each time, latest wins.
    fn apply_available_commands(&mut self, update: AcpAvailableCommandsUpdate) -> bool {
        let commands: Vec<AvailableCommand> = update
            .available_commands
            .into_iter()
            .map(|command| AvailableCommand {
                name: command.name,
                description: command.description,
                input_hint: command.input.and_then(|input| match input {
                    AvailableCommandInput::Unstructured(input) => Some(input.hint),
                    // `#[non_exhaustive]`; unstructured text is the only
                    // input ACP defines, so an unknown shape carries no hint
                    // this fold can show.
                    _ => None,
                }),
            })
            .collect();
        let changed = self.metadata.available_commands != commands;
        self.metadata.available_commands = commands;
        changed
    }

    /// Handle a `session_info_update`: take the title, minding the
    /// absent/null/value distinction - absent means unchanged.
    fn apply_session_info(&mut self, update: &SessionInfoUpdate) -> bool {
        let title = match &update.title {
            MaybeUndefined::Undefined => return false,
            MaybeUndefined::Null => None,
            MaybeUndefined::Value(title) => Some(title.clone()),
        };
        let changed = self.metadata.title != title;
        self.metadata.title = title;
        changed
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

        let (changed, position) = self.push_agent_part(MessagePart::Permission {
            tool_call: tool_call.clone(),
            options,
            outcome: PermissionOutcome::Pending,
        })?;
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
        if let Some(MessagePart::Permission {
            outcome: existing, ..
        }) = parts.get_mut(position)
        {
            *existing = outcome;
        }
        Some(Changed::updated(message))
    }

    /// Append agent prose, extending the trailing text part when there is one.
    fn append_text(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Text { text: existing } = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Text { text })
            .map(|(changed, _)| changed)
    }

    /// Append agent reasoning, extending the trailing thought part when there
    /// is one.
    fn append_thought(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Thought { text: existing } = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Thought { text })
            .map(|(changed, _)| changed)
    }

    /// Close the open turn, recording on its agent message how it stopped.
    ///
    /// Usually the agent message has been in [`State::messages`] since the
    /// agent's first part, and all that is left is the stop reason. When the
    /// agent produced nothing at all, one is minted to carry it: readers ask
    /// whether a turn is running by looking for a stop reason on the
    /// transcript's tail, so recording none anywhere reads as working
    /// forever. That is a stop pressed before the first chunk - a first
    /// prompt spends ~10s creating the Cursor agent - which answers
    /// `session/prompt` with `cancelled` and nothing to stamp it on.
    fn close_turn(&mut self, stop: Option<StopReason>) -> Option<Changed> {
        let Some(stop) = stop else {
            // Nothing to record, so nothing to mint a message for.
            self.turn = None;
            return None;
        };
        let turn = self.turn.take()?;
        let (message, changed) = match turn.agent {
            Some(message) => (message, Changed::updated(message)),
            // A turn a control opened is skipped by those readers, so an
            // empty agent bubble under its line would be noise, not a fix.
            None if !turn.expects_reply => return None,
            None => self.mint_agent_message(turn.id),
        };
        self.messages[message].stop = Some(stop);
        Some(changed)
    }

    /// Mint the agent message a turn never opened, so a stop reason has
    /// somewhere to sit. Reported as new: the client has not seen it.
    fn mint_agent_message(&mut self, turn: TurnId) -> (usize, Changed) {
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id: turn,
            author: Author::Agent,
            request_id: None,
            parts: NonEmpty::one(MessagePart::Text {
                text: String::new(),
            }),
            stop: None,
        });
        (message, Changed::new(message))
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
                request_id: None,
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
            plan_position: None,
            expects_reply: true,
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
    locations: &[ToolCallLocation],
    meta: Option<&Meta>,
) -> ToolDetail {
    match kind {
        ToolKind::Execute => ToolDetail::Terminal {
            command: command_from_raw_input(raw_input),
            output: claude_code::terminal_output(meta).map(AnsiText),
            exit_code: claude_code::terminal_exit_code(meta),
        },
        ToolKind::Edit => ToolDetail::Edit {
            diffs: edit_diffs(content, raw_input),
        },
        ToolKind::Read => ToolDetail::Read {
            paths: location_paths(locations),
        },
        ToolKind::Delete => ToolDetail::Delete {
            paths: location_paths(locations),
        },
        ToolKind::Move => ToolDetail::Move {
            paths: location_paths(locations),
        },
        ToolKind::Search => ToolDetail::Search {
            paths: location_paths(locations),
            output: generic_output(content),
        },
        ToolKind::Fetch => ToolDetail::Fetch {
            output: generic_output(content),
        },
        ToolKind::Think => ToolDetail::Think {
            output: generic_output(content),
        },
        other => ToolDetail::Other {
            kind: tool_kind_name(other).to_owned(),
            output: generic_output(content),
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
    locations: Option<&[ToolCallLocation]>,
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
            // A call that never reports a diff block (Claude Code's `Write`)
            // may still deliver its raw input on a later update.
            if existing.is_empty()
                && let Some(found) = synthesized_edit_diff(raw_input)
            {
                *existing = vec![found];
            }
        }
        ToolDetail::Read { paths } | ToolDetail::Delete { paths } | ToolDetail::Move { paths } => {
            if let Some(found) = locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
        }
        ToolDetail::Search { paths, output } => {
            if let Some(found) = locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
        ToolDetail::Fetch { output } | ToolDetail::Think { output } => {
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
        ToolDetail::Other { input, output, .. } => {
            if let Some(found) = raw_input {
                *input = Some(found.clone());
            }
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
    }
}

/// An edit call's diffs: the reported diff blocks, or — for calls that never
/// report one, like Claude Code's `Write` — a whole-file diff synthesized
/// from the raw input.
fn edit_diffs(content: &[ToolCallContent], raw_input: Option<&serde_json::Value>) -> Vec<FileDiff> {
    let found = diffs(content);
    if !found.is_empty() {
        return found;
    }
    synthesized_edit_diff(raw_input).into_iter().collect()
}

/// A whole-file diff from `{filePath, content}` raw input. The prior contents
/// are not on the wire, so the file reads as new.
fn synthesized_edit_diff(raw_input: Option<&serde_json::Value>) -> Option<FileDiff> {
    let (path, content) = file_edit_from_raw_input(raw_input)?;
    Some(FileDiff {
        path: path.into(),
        old_text: None,
        new_text: content,
    })
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

/// The paths among a tool call's reported locations.
///
/// The one source this fold trusts for "what path did this call touch" -
/// `locations` is ACP's own field, meant for exactly this, unlike `rawInput`,
/// whose keys are a harness's own convention with no fixed shape to read.
fn location_paths(locations: &[ToolCallLocation]) -> Vec<PathBuf> {
    locations
        .iter()
        .map(|location| location.path.clone())
        .collect()
}

/// The text among a tool call's content blocks - e.g. search matches or a
/// fetched page's text - joined in order.
///
/// `None` when none of the blocks carry text, same as an empty result: there
/// is nothing useful to distinguish "reported nothing" from "reported an
/// empty string."
fn generic_output(content: &[ToolCallContent]) -> Option<String> {
    let text = content
        .iter()
        .filter_map(|block| match block {
            ToolCallContent::Content(Content {
                content: block_content,
                ..
            }) => content_block_text(block_content.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
}

/// An ACP plan entry in the fold's own vocabulary.
fn plan_entry(entry: agent_client_protocol::schema::v1::PlanEntry) -> PlanEntry {
    PlanEntry {
        content: entry.content,
        priority: plan_entry_priority(entry.priority),
        status: plan_entry_status(entry.status),
    }
}

fn plan_entry_priority(
    priority: agent_client_protocol::schema::v1::PlanEntryPriority,
) -> PlanEntryPriority {
    use agent_client_protocol::schema::v1::PlanEntryPriority as Acp;
    match priority {
        Acp::High => PlanEntryPriority::High,
        Acp::Medium => PlanEntryPriority::Medium,
        Acp::Low => PlanEntryPriority::Low,
        // `#[non_exhaustive]`; a priority ACP adds later is not demonstrably
        // more or less important than the middle.
        _ => PlanEntryPriority::Medium,
    }
}

fn plan_entry_status(
    status: agent_client_protocol::schema::v1::PlanEntryStatus,
) -> PlanEntryStatus {
    use agent_client_protocol::schema::v1::PlanEntryStatus as Acp;
    match status {
        Acp::Pending => PlanEntryStatus::Pending,
        Acp::InProgress => PlanEntryStatus::InProgress,
        Acp::Completed => PlanEntryStatus::Completed,
        // `#[non_exhaustive]`; an unknown status has not demonstrably
        // finished, same as `ToolStatus`.
        _ => PlanEntryStatus::Pending,
    }
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
