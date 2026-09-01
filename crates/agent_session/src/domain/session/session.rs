//! The machine itself: one input in, ordered effects out.

use std::collections::VecDeque;

use agent_client_protocol::schema::v1::{
    InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse, McpServer,
    NewSessionRequest, NewSessionResponse, PermissionOptionKind, RequestId,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse, Response,
    ResumeSessionRequest, ResumeSessionResponse, SelectedPermissionOutcome, SessionId,
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
    CloseReason, Effect, Input, PendingAction, RuntimeStatus, SessionOpening, SessionPhase,
    SessionRestoreSupport, StopReason,
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
            SessionPhase::Live { session_id } => RuntimeStatus::Live {
                session_id: session_id.clone(),
            },
            SessionPhase::Dead => RuntimeStatus::Dead,
        }
    }

    /// Number of accepted actions that have not reached the transport.
    pub fn pending_count(&self) -> usize {
        self.pending.len()
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

        // A superseding action - a stop - means the queued actions must not
        // reach the agent at all, rather than being sent and then cancelled.
        if action.supersedes_queued() {
            self.drop_pending(&mut effects);
        }

        let session_id = match &self.phase {
            SessionPhase::Booting
            | SessionPhase::Initializing { .. }
            | SessionPhase::Opening { .. } => {
                self.pending.push_back(PendingAction {
                    from,
                    action,
                    action_id,
                    token,
                });
                return effects;
            }
            SessionPhase::Live { session_id } => session_id.clone(),
            SessionPhase::Dead => {
                effects.push(Effect::Complete {
                    token,
                    result: Err(AgentSessionError::Disconnected(self.id)),
                });
                return effects;
            }
        };

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
            self.respond_to_permission_request(&frame, effects);
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
        let (method, params) = InitializeRequest::new(PROTOCOL_VERSION)
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

    /// Send everything queued, oldest first. Each action's [`Effect::Complete`]
    /// directly follows its [`Effect::Send`], so the shell aborting a batch
    /// mid-way strands no false completions - and an action that cannot be
    /// expressed as ACP fails alone, without taking the connection down.
    fn flush(&mut self, session_id: &SessionId, effects: &mut Vec<Effect<Token>>) {
        while let Some(queued) = self.pending.pop_front() {
            let request_id = queued.action_id.to_request_id();
            match queued.action.to_runtime(session_id, request_id) {
                Ok(message) => {
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

    /// Drop every queued action without sending it, resolving each caller.
    ///
    /// `Ok` rather than an error: the action was accepted and then superseded
    /// by a later one, which is not a failure of the caller's request. It also
    /// matters upstream - the harness treats `Disconnected` as "reattach and
    /// resend", which would resurrect the very prompt a stop just dropped.
    fn drop_pending(&mut self, effects: &mut Vec<Effect<Token>>) {
        while let Some(queued) = self.pending.pop_front() {
            effects.push(Effect::Complete {
                token: queued.token,
                result: Ok(()),
            });
        }
    }

    /// End the connection: fail everything queued, then stop. The `Stop` is
    /// last so the shell resolves waiting callers before it tears down.
    fn die(&mut self, reason: StopReason, effects: &mut Vec<Effect<Token>>) {
        self.phase = SessionPhase::Dead;
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
