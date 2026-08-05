//! The machine itself: one input in, ordered effects out.

use std::collections::VecDeque;

use agent_client_protocol::schema::v1::{
    InitializeRequest, NewSessionRequest, NewSessionResponse, RequestId, Response,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_runtime_protocol::domain::acp_id::AcpId;
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::AgentSessionError;
use crate::domain::model::AgentSessionId;
use crate::{AGENT_WORKING_DIRECTORY, PROTOCOL_VERSION};

use super::types::{
    CloseReason, Effect, Input, PendingAction, RuntimeStatus, SessionPhase, StopReason,
};

/// Protocol state for one connection of a session to an agent runtime.
///
/// See the [module docs](super) for scope and the sans-IO contract.
pub struct SessionMachine<Token> {
    id: AgentSessionId,
    phase: SessionPhase,
    next_request: u64,
    /// Held outside the phase so a partial flush strands nothing.
    pending: VecDeque<PendingAction<Token>>,
}

impl<Token> SessionMachine<Token> {
    /// A fresh connection for `id`: booting, nothing queued.
    pub fn new(id: AgentSessionId) -> Self {
        Self {
            id,
            phase: SessionPhase::Booting,
            next_request: 0,
            pending: VecDeque::new(),
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
            SessionPhase::Handshaking { .. } => RuntimeStatus::Handshaking,
            SessionPhase::Live { .. } => RuntimeStatus::Live,
            SessionPhase::Dead => RuntimeStatus::Dead,
        }
    }

    /// ACP session identifier, once the handshake has completed.
    pub fn acp_id(&self) -> Option<&AcpId> {
        match &self.phase {
            SessionPhase::Live { acp } => Some(acp),
            _ => None,
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
                token,
            } => self.on_command(from, action, token),
            Input::Inbound(message) => self.on_inbound(message),
            Input::Closed(reason) => self.on_closed(reason),
        }
    }

    fn on_command(
        &mut self,
        from: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
        token: Token,
    ) -> Vec<Effect<Token>> {
        let acp = match &self.phase {
            SessionPhase::Booting | SessionPhase::Handshaking { .. } => {
                self.pending.push_back(PendingAction {
                    from,
                    action,
                    token,
                });
                return Vec::new();
            }
            SessionPhase::Live { acp } => acp.clone(),
            SessionPhase::Dead => {
                return vec![Effect::Complete {
                    token,
                    result: Err(AgentSessionError::Disconnected(self.id)),
                }];
            }
        };

        // Through the queue even when live, so an action can never overtake
        // one accepted earlier. (A completed flush leaves the queue empty, so
        // the flush below sends exactly this action.)
        self.pending.push_back(PendingAction {
            from,
            action,
            token,
        });
        let mut effects = Vec::new();
        self.flush(&acp, &mut effects);
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

    /// Ready means handshakeable, not sendable: `initialize` and `session/new`
    /// go out together, and queued actions keep waiting for the ACP id.
    fn begin_handshake(&mut self, effects: &mut Vec<Effect<Token>>) {
        // A second ready report (or one on a live session) changes nothing.
        if !matches!(self.phase, SessionPhase::Booting) {
            return;
        }

        let handshake = (|| -> std::result::Result<_, agent_client_protocol::Error> {
            let (method, params) = InitializeRequest::new(PROTOCOL_VERSION)
                .to_untyped_message()?
                .into_parts();
            let initialize = RawJsonRpcMessage::request(method, params, self.next_id())?;

            let opened = self.next_id();
            let (method, params) = NewSessionRequest::new(AGENT_WORKING_DIRECTORY)
                .to_untyped_message()?
                .into_parts();
            let open = RawJsonRpcMessage::request(method, params, opened.clone())?;
            Ok((initialize, open, opened))
        })();

        match handshake {
            Ok((initialize, open, opened)) => {
                effects.push(Effect::Send {
                    from: None,
                    message: ToRuntimeMessage::Acp(AcpMessage(initialize)),
                });
                effects.push(Effect::Send {
                    from: None,
                    message: ToRuntimeMessage::Acp(AcpMessage(open)),
                });
                self.phase = SessionPhase::Handshaking { opened };
            }
            // Building the handshake is pure serialization; failing it means
            // this connection can never become live.
            Err(error) => self.die(
                StopReason::HandshakeNotBuildable(error.to_string()),
                effects,
            ),
        }
    }

    fn on_frame(&mut self, frame: RawJsonRpcMessage, effects: &mut Vec<Effect<Token>>) {
        // Until the handshake answer arrives, ours is the only conversation;
        // past it, frames belong to whoever sent the matching request and the
        // machine only carries them.
        let SessionPhase::Handshaking { opened } = &self.phase else {
            return;
        };
        if frame.response_id() != Some(opened) {
            return;
        }

        let RawJsonRpcMessage::Response(Response::Result { result, .. }) = &frame else {
            self.die(StopReason::SessionRefused, effects);
            return;
        };
        let acp: AcpId = match serde_json::from_value::<NewSessionResponse>(result.clone()) {
            Ok(response) => response.session_id.into(),
            Err(error) => {
                self.die(
                    StopReason::SessionUnintelligible(error.to_string()),
                    effects,
                );
                return;
            }
        };

        self.phase = SessionPhase::Live { acp: acp.clone() };
        self.flush(&acp, effects);
    }

    /// Send everything queued, oldest first. Each action's [`Effect::Complete`]
    /// directly follows its [`Effect::Send`], so the shell aborting a batch
    /// mid-way strands no false completions - and an action that cannot be
    /// expressed as ACP fails alone, without taking the connection down.
    fn flush(&mut self, acp: &AcpId, effects: &mut Vec<Effect<Token>>) {
        while let Some(queued) = self.pending.pop_front() {
            let request_id = self.next_id();
            match queued.action.to_runtime(acp, request_id) {
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

    /// Namespaced so a caller's request id can never collide with ours.
    fn next_id(&mut self) -> RequestId {
        let id = RequestId::Str(format!("agent_session:{}", self.next_request));
        self.next_request += 1;
        id
    }
}
