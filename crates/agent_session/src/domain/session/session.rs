//! The machine itself: one input in, ordered effects out.

use std::collections::VecDeque;

use agent_client_protocol::schema::v1::{
    ClientCapabilities, CreateElicitationRequest, CreateElicitationResponse, ElicitationAction,
    ElicitationCapabilities, ElicitationFormCapabilities, ElicitationMode, ElicitationScope,
    ElicitationUrlCapabilities, InitializeRequest, InitializeResponse, LoadSessionRequest,
    LoadSessionResponse, McpServer, NewSessionRequest, NewSessionResponse, PermissionOptionKind,
    RequestId, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    Response, ResumeSessionRequest, ResumeSessionResponse, SelectedPermissionOutcome, SessionId,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::PROTOCOL_VERSION;
use crate::domain::error::AgentSessionError;
use crate::domain::model::AgentSessionId;

use super::types::{
    CloseReason, Effect, Input, PendingAction, PendingElicitation, RuntimeStatus, SessionOpening,
    SessionPhase, SessionRestoreSupport, StopReason,
};

const INITIAL_REQUEST_NUM: u64 = 0;

/// Protocol state for one connection of a session to an agent runtime.
///
/// See the [module docs](super) for scope and the sans-IO contract.
pub struct SessionMachine<Token> {
    id: AgentSessionId,
    phase: SessionPhase,
    next_request: u64,
    /// Held outside the phase so a partial flush strands nothing.
    pending: VecDeque<PendingAction<Token>>,
    /// The newest turn-occupying request the runtime has not answered yet.
    /// The harness dispatches its queue one turn at a time, so there is at
    /// most one in the ordinary course; a direct `send_action` caller racing
    /// the previous turn's answer displaces the old entry (see
    /// [`Self::flush`]). Its response - result or error alike - is what emits
    /// [`Effect::TurnEnded`].
    in_flight_turn: Option<(RequestId, AgentActionId)>,
    resume_session_id: Option<SessionId>,
    /// Directory the agent works in, snapshotted on the session row at
    /// creation; `session/new`, `session/resume`, and `session/load` all
    /// carry it, so a reconnect re-enters the directory the session
    /// actually ran in.
    workspace: String,
    /// MCP servers the agent is told to connect to. Carried by `session/new`,
    /// `session/resume`, and `session/load` alike, because the agent process
    /// behind a reconnect is fresh and holds no server from before.
    mcp_servers: Vec<McpServer>,
}

impl<Token> SessionMachine<Token> {
    /// A fresh connection for `id`: booting, nothing queued.
    pub fn new(id: AgentSessionId, workspace: String, mcp_servers: Vec<McpServer>) -> Self {
        Self {
            id,
            phase: SessionPhase::Booting,
            next_request: INITIAL_REQUEST_NUM,
            pending: VecDeque::new(),
            in_flight_turn: None,
            resume_session_id: None,
            workspace,
            mcp_servers,
        }
    }

    /// A fresh connection that must restore an existing ACP session.
    pub fn resume(
        id: AgentSessionId,
        session_id: SessionId,
        workspace: String,
        mcp_servers: Vec<McpServer>,
    ) -> Self {
        Self {
            id,
            phase: SessionPhase::Booting,
            next_request: INITIAL_REQUEST_NUM,
            pending: VecDeque::new(),
            in_flight_turn: None,
            resume_session_id: Some(session_id),
            workspace,
            mcp_servers,
        }
    }

    /// The session this connection belongs to.
    pub fn id(&self) -> AgentSessionId {
        self.id
    }

    /// Current phase.
    pub fn status(&self) -> RuntimeStatus {
        match &self.phase {
            SessionPhase::Booting => RuntimeStatus::Booting,
            SessionPhase::Initializing { .. } | SessionPhase::Opening { .. } => {
                RuntimeStatus::Handshaking
            }
            SessionPhase::Live { session_id, .. } => RuntimeStatus::Live {
                session_id: session_id.clone(),
            },
            SessionPhase::Dead => RuntimeStatus::Dead,
        }
    }

    /// Number of accepted actions that have not reached the transport.
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// The id of the elicitation this connection is holding for the user, if
    /// any.
    pub fn pending_elicitation(&self) -> Option<&RequestId> {
        match &self.phase {
            SessionPhase::Live {
                elicitation: Some(pending),
                ..
            } => Some(&pending.request_id),
            _ => None,
        }
    }

    /// Advance the machine by one input, returning the effects it implies.
    pub fn handle(&mut self, input: Input<Token>) -> Vec<Effect<Token>> {
        match input {
            Input::Command {
                from,
                action,
                action_id,
                token,
            } => self.on_command(from, action, action_id, token),
            Input::Inbound(message) => self.on_inbound(message),
            Input::Ready { restore } => self.on_connection_ready(restore),
            Input::Closed(reason) => self.on_closed(reason),
        }
    }

    /// Open on a connection somebody else initialized.
    ///
    /// Ignored unless still booting: the machine that ran the handshake is
    /// told its own result this way too, and a session already opening or
    /// live has nothing to learn from it.
    fn on_connection_ready(&mut self, restore: SessionRestoreSupport) -> Vec<Effect<Token>> {
        let mut effects = Vec::new();
        if matches!(self.phase, SessionPhase::Booting) {
            self.begin_opening(restore, &mut effects);
        }
        effects
    }

    fn on_command(
        &mut self,
        from: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
        action_id: AgentActionId,
        token: Token,
    ) -> Vec<Effect<Token>> {
        let mut effects = Vec::new();

        // A stop cancels the question the agent is waiting on, and does so
        // before the cancel notification goes out, so the agent hears the
        // answer to its request before it hears that the turn is over.
        if matches!(action, AgentAction::Stop) {
            self.cancel_pending_elicitation(from.clone(), &mut effects);
        }

        let session_id = match &self.phase {
            SessionPhase::Booting
            | SessionPhase::Initializing { .. }
            | SessionPhase::Opening { .. } => {
                // An answer cannot be queued: it names a request id that only
                // a live connection could have received, and any connection
                // that opens from here is a fresh one.
                if let AgentAction::RespondElicitation(_) = &action {
                    effects.push(Effect::Complete {
                        token,
                        result: Err(AgentSessionError::ElicitationNotPending(self.id)),
                    });
                    return effects;
                }
                self.pending.push_back(PendingAction {
                    from,
                    action,
                    action_id,
                    token,
                });
                return effects;
            }
            SessionPhase::Live { session_id, .. } => session_id.clone(),
            SessionPhase::Dead => {
                effects.push(Effect::Complete {
                    token,
                    result: Err(AgentSessionError::Disconnected(self.id)),
                });
                return effects;
            }
        };

        // An answer must match the one elicitation being held, and answering
        // it releases the slot before the response goes out.
        if let AgentAction::RespondElicitation(answer) = &action {
            let matches = matches!(
                &self.phase,
                SessionPhase::Live { elicitation: Some(pending), .. }
                    if pending.request_id == answer.request_id.to_request_id()
            );
            if !matches {
                effects.push(Effect::Complete {
                    token,
                    result: Err(AgentSessionError::ElicitationNotPending(self.id)),
                });
                return effects;
            }
            if let SessionPhase::Live { elicitation, .. } = &mut self.phase {
                *elicitation = None;
            }
        }

        // Through the queue even when live, so an action can never overtake
        // one accepted earlier. (A completed flush leaves the queue empty, so
        // the flush below sends exactly this action.)
        self.pending.push_back(PendingAction {
            from,
            action,
            action_id,
            token,
        });
        self.flush(&session_id, &mut effects);
        effects
    }

    fn on_inbound(&mut self, message: ToServerMessage) -> Vec<Effect<Token>> {
        // Every inbound message is logged, before anything reacts to it: the
        // log stream is the session's history, not a digest of it.
        let mut effects = vec![Effect::Log {
            message: message.clone(),
        }];

        match message {
            ToServerMessage::Event {
                event: SystemEvent::AcpReady,
            } => self.begin_handshake(&mut effects),
            ToServerMessage::Acp(AcpMessage(frame)) => self.on_frame(frame, &mut effects),
            _ => {}
        }

        effects
    }

    fn on_closed(&mut self, reason: CloseReason) -> Vec<Effect<Token>> {
        if matches!(self.phase, SessionPhase::Dead) {
            return Vec::new();
        }
        let mut effects = Vec::new();
        self.die(StopReason::Closed(reason), &mut effects);
        effects
    }

    /// Ready starts initialization; actions remain queued until `session/new` completes.
    fn begin_handshake(&mut self, effects: &mut Vec<Effect<Token>>) {
        if !matches!(self.phase, SessionPhase::Booting) {
            return;
        }

        match self.build_initialize_request() {
            Ok((initialize, request_id)) => {
                effects.push(Effect::Send {
                    from: None,
                    message: ToRuntimeMessage::Acp(AcpMessage(initialize)),
                });
                self.phase = SessionPhase::Initializing { request_id };
            }
            Err(error) => self.die(
                StopReason::HandshakeNotBuildable(error.to_string()),
                effects,
            ),
        }
    }

    fn on_frame(&mut self, frame: RawJsonRpcMessage, effects: &mut Vec<Effect<Token>>) {
        if matches!(self.phase, SessionPhase::Live { .. }) {
            // The in-flight turn's answer ends the turn whichever shape it
            // takes: a result carries the stop reason, an error is the agent
            // refusing the prompt. Either way the agent can take another.
            if let Some((request_id, _)) = &self.in_flight_turn
                && frame.response_id() == Some(request_id)
            {
                let (_, action_id) = self
                    .in_flight_turn
                    .take()
                    .expect("checked just above; nothing between the check and the take");
                effects.push(Effect::TurnEnded { action_id });
                return;
            }
            self.respond_to_permission_request(&frame, effects);
            self.hold_or_refuse_elicitation(&frame, effects);
            return;
        }

        match &self.phase {
            SessionPhase::Initializing { request_id }
                if frame.response_id() == Some(request_id) =>
            {
                self.on_initialized(&frame, effects);
            }
            SessionPhase::Opening { request_id, .. } if frame.response_id() == Some(request_id) => {
                self.on_session_opened(&frame, effects);
            }
            _ => {}
        }
    }

    fn on_initialized(&mut self, frame: &RawJsonRpcMessage, effects: &mut Vec<Effect<Token>>) {
        let RawJsonRpcMessage::Response(Response::Result { result, .. }) = &frame else {
            self.die(StopReason::InitializationRefused, effects);
            return;
        };
        let response = match serde_json::from_value::<InitializeResponse>(result.clone()) {
            Ok(response) => response,
            Err(error) => {
                self.die(
                    StopReason::InitializationUnintelligible(error.to_string()),
                    effects,
                );
                return;
            }
        };

        let restore = SessionRestoreSupport {
            resume: response
                .agent_capabilities
                .session_capabilities
                .resume
                .is_some(),
            load: response.agent_capabilities.load_session,
        };
        // Announced before this session opens: every other session on this
        // connection needs the same answer, and only this machine was told it.
        effects.push(Effect::Initialized { restore });
        self.begin_opening(restore, effects);
    }

    /// Ask the agent for this session, however it has to be established.
    fn begin_opening(&mut self, restore: SessionRestoreSupport, effects: &mut Vec<Effect<Token>>) {
        let opening = match self.resume_session_id.clone() {
            Some(session_id) if restore.resume => self.build_resume_session_request(session_id),
            Some(session_id) if restore.load => self.build_load_session_request(session_id),
            Some(_) => {
                self.resume_unsupported(effects);
                return;
            }
            None => self.build_new_session_request(),
        };

        match opening {
            Ok((open, request_id, kind)) => {
                effects.push(Effect::Send {
                    from: None,
                    message: ToRuntimeMessage::Acp(AcpMessage(open)),
                });
                self.phase = SessionPhase::Opening { request_id, kind };
            }
            Err(error) => {
                self.die(
                    StopReason::HandshakeNotBuildable(error.to_string()),
                    effects,
                );
            }
        }
    }

    fn on_session_opened(&mut self, frame: &RawJsonRpcMessage, effects: &mut Vec<Effect<Token>>) {
        let RawJsonRpcMessage::Response(Response::Result { result, .. }) = frame else {
            self.die(StopReason::SessionRefused, effects);
            return;
        };
        let kind = match &self.phase {
            SessionPhase::Opening { kind, .. } => kind.clone(),
            _ => return,
        };
        let (session_id, persist) = match kind {
            SessionOpening::New => {
                match serde_json::from_value::<NewSessionResponse>(result.clone()) {
                    Ok(response) => (response.session_id, true),
                    Err(error) => {
                        self.die(
                            StopReason::SessionUnintelligible(error.to_string()),
                            effects,
                        );
                        return;
                    }
                }
            }
            SessionOpening::Resume(session_id) => {
                if let Err(error) = serde_json::from_value::<ResumeSessionResponse>(result.clone())
                {
                    self.die(
                        StopReason::SessionUnintelligible(error.to_string()),
                        effects,
                    );
                    return;
                }
                (session_id, false)
            }
            SessionOpening::Load(session_id) => {
                if let Err(error) = serde_json::from_value::<LoadSessionResponse>(result.clone()) {
                    self.die(
                        StopReason::SessionUnintelligible(error.to_string()),
                        effects,
                    );
                    return;
                }
                (session_id, false)
            }
        };

        self.phase = SessionPhase::Live {
            session_id: session_id.clone(),
            elicitation: None,
        };
        if persist {
            effects.push(Effect::PersistAcpSession {
                session_id: session_id.clone(),
            });
        }
        self.flush(&session_id, effects);
    }

    fn build_session_request<Request: JsonRpcMessage + serde::Serialize>(
        &mut self,
        request: Request,
        kind: SessionOpening,
    ) -> std::result::Result<
        (RawJsonRpcMessage, RequestId, SessionOpening),
        agent_client_protocol::Error,
    > {
        let (method, params) = request.to_untyped_message()?.into_parts();
        let request_id = self.next_id();
        let request = RawJsonRpcMessage::request(method, params, request_id.clone())?;
        Ok((request, request_id, kind))
    }

    fn build_resume_session_request(
        &mut self,
        session_id: SessionId,
    ) -> std::result::Result<
        (RawJsonRpcMessage, RequestId, SessionOpening),
        agent_client_protocol::Error,
    > {
        self.build_session_request(
            ResumeSessionRequest::new(session_id.clone(), self.workspace.clone())
                .mcp_servers(self.mcp_servers.clone()),
            SessionOpening::Resume(session_id),
        )
    }

    fn build_load_session_request(
        &mut self,
        session_id: SessionId,
    ) -> std::result::Result<
        (RawJsonRpcMessage, RequestId, SessionOpening),
        agent_client_protocol::Error,
    > {
        self.build_session_request(
            LoadSessionRequest::new(session_id.clone(), self.workspace.clone())
                .mcp_servers(self.mcp_servers.clone()),
            SessionOpening::Load(session_id),
        )
    }

    fn build_initialize_request(
        &mut self,
    ) -> std::result::Result<(RawJsonRpcMessage, RequestId), agent_client_protocol::Error> {
        // Both elicitation modes are advertised: the session page renders
        // forms and opens URLs after consent. Agents that check (they must)
        // will only ask once this says they may - so this line must never
        // ship ahead of `hold_or_refuse_elicitation`, or every agent that
        // asks hangs on a request nothing answers.
        let capabilities = ClientCapabilities::new().elicitation(
            ElicitationCapabilities::new()
                .form(ElicitationFormCapabilities::new())
                .url(ElicitationUrlCapabilities::new()),
        );
        let (method, params) = InitializeRequest::new(PROTOCOL_VERSION)
            .client_capabilities(capabilities)
            .to_untyped_message()?
            .into_parts();
        let request_id = self.next_id();
        let request = RawJsonRpcMessage::request(method, params, request_id.clone())?;
        Ok((request, request_id))
    }

    fn build_new_session_request(
        &mut self,
    ) -> std::result::Result<
        (RawJsonRpcMessage, RequestId, SessionOpening),
        agent_client_protocol::Error,
    > {
        self.build_session_request(
            NewSessionRequest::new(self.workspace.clone()).mcp_servers(self.mcp_servers.clone()),
            SessionOpening::New,
        )
    }

    /// Permission prompts require a client response. This autonomous agent has
    /// no approval UI, so approve the broadest offered allow option instead of
    /// leaving the turn blocked forever.
    fn respond_to_permission_request(
        &self,
        frame: &RawJsonRpcMessage,
        effects: &mut Vec<Effect<Token>>,
    ) {
        let RawJsonRpcMessage::Request(request) = frame else {
            return;
        };
        if !RequestPermissionRequest::matches_method(&request.method) {
            return;
        }

        let outcome = request
            .params
            .clone()
            .and_then(|params| {
                serde_json::from_value::<RequestPermissionRequest>(params.into_value()).ok()
            })
            .and_then(|request| {
                request
                    .options
                    .iter()
                    .find(|option| matches!(option.kind, PermissionOptionKind::AllowAlways))
                    .or_else(|| {
                        request
                            .options
                            .iter()
                            .find(|option| matches!(option.kind, PermissionOptionKind::AllowOnce))
                    })
                    .map(|option| option.option_id.clone())
            })
            .map(|option_id| {
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id))
            })
            .unwrap_or(RequestPermissionOutcome::Cancelled);
        let response = RequestPermissionResponse::new(outcome);
        let Ok(result) = serde_json::to_value(response) else {
            return;
        };
        effects.push(Effect::Send {
            from: None,
            message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                request.id.clone(),
                Ok(result),
            ))),
        });
    }

    /// An `elicitation/create` is held for the user rather than answered - the
    /// one agent request this machine does not resolve on its own. What
    /// cannot be held is refused on the spot with `-32602`, the code the
    /// protocol names for a mode the client did not advertise: a request
    /// this machine cannot parse, a mode it does not render, a request
    /// scoped outside any session, one for another session on the same
    /// connection, or a second question while the first is still open.
    fn hold_or_refuse_elicitation(
        &mut self,
        frame: &RawJsonRpcMessage,
        effects: &mut Vec<Effect<Token>>,
    ) {
        let RawJsonRpcMessage::Request(request) = frame else {
            return;
        };
        if !CreateElicitationRequest::matches_method(&request.method) {
            return;
        }
        let SessionPhase::Live {
            session_id,
            elicitation,
        } = &mut self.phase
        else {
            return;
        };

        let parsed = request
            .params
            .clone()
            .ok_or("an elicitation needs params")
            .and_then(|params| {
                serde_json::from_value::<CreateElicitationRequest>(params.into_value())
                    .map_err(|_| "the elicitation did not parse")
            });
        let refusal = match parsed {
            Err(reason) => Some(reason),
            Ok(elicitation_request) => {
                let scope = match &elicitation_request.mode {
                    ElicitationMode::Form(form) => Some(&form.scope),
                    ElicitationMode::Url(url) => Some(&url.scope),
                    // `#[non_exhaustive]`: an `Other` mode, or one ACP adds later.
                    _ => None,
                };
                match scope {
                    None => Some("this client renders only form and url elicitations"),
                    Some(ElicitationScope::Request(_)) => {
                        Some("request-scoped elicitation is not supported")
                    }
                    Some(ElicitationScope::Session(scope)) if &scope.session_id != session_id => {
                        Some("the elicitation names another session")
                    }
                    Some(ElicitationScope::Session(_)) if elicitation.is_some() => {
                        Some("one elicitation at a time")
                    }
                    Some(ElicitationScope::Session(_)) => None,
                    // `#[non_exhaustive]` scope.
                    Some(_) => Some("unrecognized elicitation scope"),
                }
            }
        };

        match refusal {
            None => {
                *elicitation = Some(PendingElicitation {
                    request_id: request.id.clone(),
                });
            }
            Some(reason) => {
                let error = agent_client_protocol::Error::invalid_params().data(reason);
                effects.push(Effect::Send {
                    from: None,
                    message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                        request.id.clone(),
                        Err(error),
                    ))),
                });
            }
        }
    }

    /// Answer the held elicitation with `cancel` and release the slot. What a
    /// stop does before its cancel notification, so the agent's request is
    /// resolved rather than left dangling on a turn that is ending anyway.
    fn cancel_pending_elicitation(
        &mut self,
        from: Option<MacroUserIdStr<'static>>,
        effects: &mut Vec<Effect<Token>>,
    ) {
        let SessionPhase::Live { elicitation, .. } = &mut self.phase else {
            return;
        };
        let Some(pending) = elicitation.take() else {
            return;
        };
        let Ok(result) =
            serde_json::to_value(CreateElicitationResponse::new(ElicitationAction::Cancel))
        else {
            return;
        };
        effects.push(Effect::Send {
            from,
            message: ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                pending.request_id,
                Ok(result),
            ))),
        });
    }

    /// Send everything queued, oldest first. Each action's [`Effect::Complete`]
    /// directly follows its [`Effect::Send`], so the shell aborting a batch
    /// mid-way strands no false completions - and an action that cannot be
    /// expressed as ACP fails alone, without taking the connection down.
    fn flush(&mut self, session_id: &SessionId, effects: &mut Vec<Effect<Token>>) {
        while let Some(queued) = self.pending.pop_front() {
            let request_id = queued.action_id.to_request_id();
            match queued.action.to_runtime(session_id, request_id.clone()) {
                Ok(message) => {
                    if queued.action.occupies_turn() {
                        // The harness dispatches one turn at a time, but
                        // `send_action` is public and a direct caller can race
                        // the previous turn's answer. Track the newest: its
                        // answer is what ends the turn, and the displaced
                        // one's answer simply matches nothing.
                        if let Some((_, displaced)) =
                            self.in_flight_turn.replace((request_id, queued.action_id))
                        {
                            tracing::warn!(
                                id = %self.id,
                                %displaced,
                                "a turn-occupying action was sent while a turn was in flight"
                            );
                        }
                    }
                    effects.push(Effect::Send {
                        from: queued.from,
                        message,
                    });
                    effects.push(Effect::Complete {
                        token: queued.token,
                        result: Ok(()),
                    });
                }
                Err(error) => effects.push(Effect::Complete {
                    token: queued.token,
                    result: Err(error.into()),
                }),
            }
        }
    }

    /// End the connection: fail everything queued, then stop. The `Stop` is
    /// last so the shell resolves waiting callers before it tears down.
    ///
    /// A turn that was in flight is forgotten without [`Effect::TurnEnded`]:
    /// the turn did not end, the session stopped, and the shell reports that
    /// as its own event.
    fn die(&mut self, reason: StopReason, effects: &mut Vec<Effect<Token>>) {
        self.phase = SessionPhase::Dead;
        self.in_flight_turn = None;
        while let Some(queued) = self.pending.pop_front() {
            effects.push(Effect::Complete {
                token: queued.token,
                result: Err(AgentSessionError::Disconnected(self.id)),
            });
        }
        effects.push(Effect::Stop { reason });
    }

    fn resume_unsupported(&mut self, effects: &mut Vec<Effect<Token>>) {
        self.phase = SessionPhase::Dead;
        while let Some(queued) = self.pending.pop_front() {
            effects.push(Effect::Complete {
                token: queued.token,
                result: Err(AgentSessionError::ResumeUnsupported(self.id)),
            });
        }
        effects.push(Effect::Stop {
            reason: StopReason::ResumeUnsupported,
        });
    }

    /// Namespaced so a caller's request id can never collide with ours - and
    /// carries the session, so sessions sharing one connection cannot collide
    /// with each other either.
    fn next_id(&mut self) -> RequestId {
        let id = RequestId::Str(format!("agent_session:{}:{}", self.id, self.next_request));
        self.next_request += 1;
        id
    }
}
