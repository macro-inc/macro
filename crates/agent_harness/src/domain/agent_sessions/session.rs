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
use agent_session::domain::model::{AgentSessionId, AgentSessionLog, Message};
use agent_session::domain::ports::AgentSessionLogRepo;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::agent_sessions::{PROTOCOL_VERSION, WORKSPACE};
use crate::domain::connector::AgentConnector;
use crate::domain::error::{HarnessError, Result};

/// An action accepted before there was any way to send it.
///
/// Carries who asked, because that is only knowable when the action arrives -
/// by the time it goes on the wire the request is long finished.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingAction {
    pub from: Option<MacroUserIdStr<'static>>,
    pub action: AgentAction,
}

enum SessionState {
    /// The sandbox is still booting. Nothing may go on the wire.
    Booting,
    /// `AcpReady` seen and the handshake is in flight. Actions still queue: one
    /// needs the [`AcpId`] `session/new` has not returned yet.
    Handshaking {
        /// The `session/new` we are waiting on, so its answer is recognisable.
        opened: RequestId,
    },
    Live {
        acp: AcpId,
    },
    Dead,
}

/// A session's state without its payload, so callers can observe transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Booting,
    Handshaking,
    Live,
    Dead,
}

/// One agent session and the link it speaks over.
pub struct AgentSession<Connector, Logs> {
    id: AgentSessionId,
    connector: Connector,
    logs: Logs,
    state: SessionState,
    /// Held outside [`SessionState`] so a half-finished flush leaves the
    /// remainder queued rather than dropping it with the old state.
    pending: VecDeque<PendingAction>,
    next_request: u64,
}

impl<Connector, Logs> AgentSession<Connector, Logs>
where
    Connector: AgentConnector,
    Logs: AgentSessionLogRepo,
{
    pub fn new(id: AgentSessionId, connector: Connector, logs: Logs) -> Self {
        Self {
            id,
            connector,
            logs,
            state: SessionState::Booting,
            pending: VecDeque::new(),
            next_request: 0,
        }
    }

    pub fn id(&self) -> &AgentSessionId {
        &self.id
    }

    pub fn status(&self) -> SessionStatus {
        match &self.state {
            SessionState::Booting => SessionStatus::Booting,
            SessionState::Handshaking { .. } => SessionStatus::Handshaking,
            SessionState::Live { .. } => SessionStatus::Live,
            SessionState::Dead => SessionStatus::Dead,
        }
    }

    pub fn acp_id(&self) -> Option<&AcpId> {
        match &self.state {
            SessionState::Live { acp } => Some(acp),
            _ => None,
        }
    }

    /// Actions accepted but not yet on the wire, oldest first.
    pub fn pending(&self) -> &VecDeque<PendingAction> {
        &self.pending
    }

    /// Queue an action, or send it now if the handshake has finished.
    ///
    /// `from` is the user whose request this is, when it came from one.
    pub async fn send_message(
        &mut self,
        from: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        let acp = match &self.state {
            SessionState::Booting | SessionState::Handshaking { .. } => {
                self.pending.push_back(PendingAction { from, action });
                return Ok(());
            }
            SessionState::Live { acp } => acp.clone(),
            SessionState::Dead => return Err(HarnessError::Disconnected(self.id)),
        };

        // Anything a previous flush failed to send goes first, or this action
        // would overtake it.
        self.flush(&acp).await?;
        let message = action.to_runtime(&acp, self.next_id())?;
        self.send_now(from, message).await
    }

    /// Handle one inbound message. `false` once the connector's stream ends.
    pub async fn step(&mut self) -> Result<bool> {
        let Some(message) = self.connector.recv().await? else {
            self.state = SessionState::Dead;
            return Ok(false);
        };
        self.log(None, Message::ToServer(message.clone())).await?;

        match message {
            ToServerMessage::Event {
                event: SystemEvent::AcpReady,
            } => self.begin_handshake().await?,
            ToServerMessage::Acp(AcpMessage(frame)) => self.on_frame(frame).await?,
            _ => {}
        }
        Ok(true)
    }

    /// `step` until the connector's stream ends.
    pub async fn pump(&mut self) -> Result<()> {
        while self.step().await? {}
        Ok(())
    }

    /// Ready means handshakeable, not sendable: `initialize` and `session/new`
    /// go out together, and queued actions keep waiting for the ACP session id.
    async fn begin_handshake(&mut self) -> Result<()> {
        if !matches!(self.state, SessionState::Booting) {
            return Ok(());
        }

        let (method, params) = InitializeRequest::new(PROTOCOL_VERSION)
            .to_untyped_message()?
            .into_parts();
        let frame = RawJsonRpcMessage::request(method, params, self.next_id())?;
        self.send_now(None, ToRuntimeMessage::Acp(AcpMessage(frame)))
            .await?;

        let opened = self.next_id();
        let (method, params) = NewSessionRequest::new(WORKSPACE)
            .to_untyped_message()?
            .into_parts();
        let frame = RawJsonRpcMessage::request(method, params, opened.clone())?;
        self.send_now(None, ToRuntimeMessage::Acp(AcpMessage(frame)))
            .await?;

        self.state = SessionState::Handshaking { opened };
        Ok(())
    }

    async fn on_frame(&mut self, frame: RawJsonRpcMessage) -> Result<()> {
        let SessionState::Handshaking { opened } = &self.state else {
            return Ok(());
        };
        if frame.response_id() != Some(opened) {
            return Ok(());
        }

        let RawJsonRpcMessage::Response(Response::Result { result, .. }) = &frame else {
            self.state = SessionState::Dead;
            return Err(HarnessError::Handshake(
                "the agent refused session/new".to_owned(),
            ));
        };
        let response: NewSessionResponse = serde_json::from_value(result.clone())
            .map_err(|error| HarnessError::Handshake(error.to_string()))?;

        let acp: AcpId = response.session_id.into();
        self.state = SessionState::Live { acp: acp.clone() };
        self.flush(&acp).await
    }

    /// Send everything queued, oldest first, dropping each only once it is
    /// actually gone. A failure part-way leaves the rest queued.
    async fn flush(&mut self, acp: &AcpId) -> Result<()> {
        while let Some(queued) = self.pending.front().cloned() {
            let message = queued.action.to_runtime(acp, self.next_id())?;
            self.send_now(queued.from, message).await?;
            self.pending.pop_front();
        }
        Ok(())
    }

    async fn send_now(
        &self,
        from: Option<MacroUserIdStr<'static>>,
        message: ToRuntimeMessage,
    ) -> Result<()> {
        self.log(from, Message::ToRuntime(message.clone())).await?;
        self.connector.send(message).await?;
        Ok(())
    }

    async fn log(&self, user_id: Option<MacroUserIdStr<'static>>, content: Message) -> Result<()> {
        self.logs
            .create(AgentSessionLog {
                agent_session_id: self.id,
                user_id,
                content,
            })
            .await?;
        Ok(())
    }

    /// Namespaced so a caller's request id can never collide with ours.
    fn next_id(&mut self) -> RequestId {
        let id = RequestId::Str(format!("agent_harness:{}", self.next_request));
        self.next_request += 1;
        id
    }
}
