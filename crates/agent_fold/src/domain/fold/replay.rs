//! A load is a transaction over the visible projection, not new activity.

use agent_client_protocol::schema::v1::{
    AGENT_METHOD_NAMES, InitializeRequest, LoadSessionRequest, LoadSessionResponse,
    NewSessionRequest, NewSessionResponse, PromptRequest, RequestId, Response,
    ResumeSessionRequest, ResumeSessionResponse,
};
use agent_client_protocol::{JsonRpcMessage, JsonRpcResponse, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};

use super::convert::param;
use super::state::{FoldState, StepChange};
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};

#[derive(Debug, Default)]
pub(super) struct Replay {
    session: Option<AgentSessionId>,
    initialization: FoldState,
    transaction: Option<Transaction>,
    disconnected: bool,
    // A failed/abandoned load may still have queued notifications. Handshake
    // markers invalidate correlations, but do not prove those frames are live.
    quarantined: bool,
    replay_session: Option<String>,
    pending_open: Option<(RequestId, Opening)>,
}

#[derive(Debug)]
enum Opening {
    New,
    Resume,
}

impl Opening {
    fn accepts(&self, response: &Response<serde_json::Value>) -> bool {
        let Response::Result { result, .. } = response else {
            return false;
        };
        match self {
            Self::New => {
                NewSessionResponse::from_value(AGENT_METHOD_NAMES.session_new, result.clone())
                    .is_ok()
            }
            Self::Resume => {
                ResumeSessionResponse::from_value(AGENT_METHOD_NAMES.session_resume, result.clone())
                    .is_ok()
            }
        }
    }
}

#[derive(Debug)]
struct Transaction {
    request: RequestId,
    session: String,
    metadata: crate::domain::model::SessionMetadata,
    pending_initialize: Option<RequestId>,
    entries: Vec<AgentSessionLog>,
}

pub(super) enum Outcome {
    Changes(Vec<StepChange>),
    Staged,
    Replaced,
}

impl Replay {
    fn loading(&self) -> bool {
        self.transaction.is_some()
    }

    fn commit(&mut self, committed: &mut FoldState, completion: AgentSessionLog) -> Outcome {
        let mut transaction = self.transaction.take().expect("matched transaction");
        transaction.entries.push(completion);
        let mut state = FoldState {
            metadata: transaction.metadata,
            pending_initialize: transaction.pending_initialize,
            replaying: true,
            ..FoldState::default()
        };
        for entry in transaction.entries {
            state.step(entry);
        }
        state.replaying = false;
        *committed = state;
        Outcome::Replaced
    }

    pub(super) fn step(&mut self, committed: &mut FoldState, entry: AgentSessionLog) -> Outcome {
        // One machine per Macro session. A multiplexed transport must route
        // frames before folding; a foreign response must never commit a load.
        if self
            .session
            .is_some_and(|session| session != entry.agent_session_id)
        {
            return Outcome::Staged;
        }
        self.session = Some(entry.agent_session_id);
        if let Message::ToServer(ToServerMessage::Event { event }) = &entry.content {
            if matches!(event, SystemEvent::AcpReady | SystemEvent::Disconnected) {
                self.quarantined |=
                    self.transaction.is_some() || matches!(event, SystemEvent::Disconnected);
                self.transaction = None;
                self.pending_open = None;
                self.initialization = FoldState::default();
                self.disconnected = matches!(event, SystemEvent::Disconnected);
                committed.clear_pending();
            }
            self.initialization.step(entry.clone());
            if let Some(candidate) = &mut self.transaction {
                candidate.entries.push(entry.clone());
            }
            return Outcome::Changes(committed.step(entry));
        }
        if let Message::ToRuntime(ToRuntimeMessage::Acp(acp)) = &entry.content
            && let RawJsonRpcMessage::Request(request) = &acp.0
        {
            if InitializeRequest::matches_method(&request.method) {
                // Initialization starts a correlation epoch, but does not
                // erase committed messages or imply a successful restore.
                self.quarantined |= self.loading();
                self.transaction = None;
                self.pending_open = None;
                self.disconnected = false;
                self.initialization = FoldState::default();
                self.initialization.metadata.status = Some("acp_ready".to_owned());
                committed.clear_pending();
                self.initialization.step(entry.clone());
            } else if !self.disconnected && LoadSessionRequest::matches_method(&request.method) {
                let Some(session) =
                    param(request.params.as_ref(), "sessionId").and_then(|v| v.as_str())
                else {
                    return Outcome::Staged;
                };
                self.pending_open = None;
                self.replay_session = Some(session.to_owned());
                self.transaction = Some(Transaction {
                    request: request.id.clone(),
                    session: session.to_owned(),
                    metadata: self.initialization.metadata.clone(),
                    pending_initialize: self.initialization.pending_initialize.clone(),
                    entries: vec![entry],
                });
                return Outcome::Staged;
            } else if !self.disconnected
                && self.quarantined
                && !self.loading()
                && let Some(RawJsonRpcParams::Object(params)) = request.params.as_ref()
            {
                match request.method.as_ref() {
                    method
                        if PromptRequest::matches_method(method)
                            && PromptRequest::parse_message(method, params).is_ok()
                            && self.matches_replay_session(request.params.as_ref()) =>
                    {
                        // Only dispatched prompts enter the log; SessionMachine
                        // dispatches them after the handshake reaches Live.
                        self.quarantined = false;
                        self.pending_open = None;
                        committed.clear_pending();
                    }
                    method
                        if NewSessionRequest::matches_method(method)
                            && NewSessionRequest::parse_message(method, params).is_ok() =>
                    {
                        self.pending_open = Some((request.id.clone(), Opening::New));
                        return Outcome::Changes(committed.step(entry));
                    }
                    method
                        if ResumeSessionRequest::matches_method(method)
                            && ResumeSessionRequest::parse_message(method, params).is_ok()
                            && self.matches_replay_session(request.params.as_ref()) =>
                    {
                        self.pending_open = Some((request.id.clone(), Opening::Resume));
                        return Outcome::Changes(committed.step(entry));
                    }
                    _ => {}
                }
            }
        }
        if self.disconnected {
            return Outcome::Staged;
        }
        if let Message::ToServer(ToServerMessage::Acp(acp)) = &entry.content
            && let RawJsonRpcMessage::Response(response) = &acp.0
        {
            let id = match response {
                Response::Result { id, .. } | Response::Error { id, .. } => id,
            };
            if self.initialization.pending_initialize.as_ref() == Some(id) {
                self.initialization.step(entry.clone());
                if self.transaction.is_none() {
                    return Outcome::Changes(committed.step(entry));
                }
            }
            if self
                .transaction
                .as_ref()
                .is_some_and(|candidate| &candidate.request == id)
            {
                // Match SessionMachine::on_session_opened exactly: JSON-RPC
                // success alone is insufficient; the ACP result must decode.
                if !matches!(response, Response::Result { result, .. }
                    if LoadSessionResponse::from_value(AGENT_METHOD_NAMES.session_load, result.clone()).is_ok())
                {
                    self.transaction = None;
                    self.quarantined = true;
                    return Outcome::Staged;
                }
                self.quarantined = false;
                // Load completion is not turn completion. Keep the last replayed
                // turn open so live chunks after the high-water mark append to it.
                return self.commit(committed, entry);
            }
            if self
                .pending_open
                .as_ref()
                .is_some_and(|(pending, _)| pending == id)
            {
                let (_, opening) = self.pending_open.take().expect("matched opening request");
                if opening.accepts(response) {
                    self.quarantined = false;
                } else {
                    committed.pending_config_requests.remove(id);
                    return Outcome::Staged;
                }
            }
        }
        if let Some(candidate) = &mut self.transaction {
            let params = match &entry.content {
                Message::ToServer(ToServerMessage::Acp(acp))
                | Message::ToRuntime(ToRuntimeMessage::Acp(acp)) => match &acp.0 {
                    RawJsonRpcMessage::Request(request) => request.params.as_ref(),
                    RawJsonRpcMessage::Notification(notification) => notification.params.as_ref(),
                    _ => None,
                },
                _ => None,
            };
            if param(params, "sessionId")
                .and_then(|v| v.as_str())
                .is_some_and(|session| session != candidate.session)
            {
                return Outcome::Staged;
            }
            candidate.entries.push(entry);
            return Outcome::Staged;
        }
        if self.quarantined {
            return Outcome::Staged;
        }
        Outcome::Changes(committed.step(entry))
    }

    fn matches_replay_session(
        &self,
        params: Option<&agent_client_protocol::RawJsonRpcParams>,
    ) -> bool {
        param(params, "sessionId")
            .and_then(|value| value.as_str())
            .is_some_and(|session| {
                self.replay_session
                    .as_deref()
                    .is_none_or(|expected| session == expected)
            })
    }
}
