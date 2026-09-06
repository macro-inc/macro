//! A load is a transaction over the visible projection, not new activity.

use agent_client_protocol::schema::v1::{
    AGENT_METHOD_NAMES, InitializeRequest, LoadSessionRequest, LoadSessionResponse,
    NewSessionRequest, NewSessionResponse, PromptRequest, RequestId, Response,
    ResumeSessionRequest, ResumeSessionResponse,
};
use agent_client_protocol::{JsonRpcMessage, JsonRpcResponse, RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::domain::turn::{HistorySnapshotNotification, HistorySnapshotPhase};

use super::convert::param;
use super::state::{FoldState, StepChange};
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};

#[derive(Debug, Default)]
pub(super) struct Replay {
    session: Option<AgentSessionId>,
    initialization: FoldState,
    candidate: Option<Candidate>,
    disconnected: bool,
    // A failed/abandoned load may still have queued notifications. Handshake
    // markers invalidate correlations, but do not prove those frames are live.
    quarantined: bool,
    replay_session: Option<String>,
    pending_open: Option<(RequestId, Opening)>,
    snapshot: Option<Snapshot>,
    // A snapshot already being published may finish after load is requested.
    // Its contents belong to that transaction, never to the load candidate.
    discarded_snapshot: Option<(String, String)>,
    pending_prompt: Option<RequestId>,
    pending_local: Vec<AgentSessionLog>,
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
struct Candidate {
    request: RequestId,
    session: String,
    state: FoldState,
}

#[derive(Debug)]
struct Snapshot {
    id: String,
    session: String,
    state: FoldState,
}

pub(super) enum Outcome {
    Changes(Vec<StepChange>),
    Staged,
    Replaced,
}

impl Replay {
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
        if let Message::ToRuntime(ToRuntimeMessage::Acp(acp)) = &entry.content {
            match &acp.0 {
                RawJsonRpcMessage::Request(request)
                    if PromptRequest::matches_method(&request.method) =>
                {
                    self.pending_prompt = Some(request.id.clone());
                    self.pending_local = vec![entry.clone()];
                }
                RawJsonRpcMessage::Request(request)
                    if InitializeRequest::matches_method(&request.method)
                        || LoadSessionRequest::matches_method(&request.method)
                        || NewSessionRequest::matches_method(&request.method)
                        || ResumeSessionRequest::matches_method(&request.method) =>
                {
                    if LoadSessionRequest::matches_method(&request.method) {
                        if let Some(snapshot) = self.snapshot.take() {
                            self.discarded_snapshot = Some((snapshot.id, snapshot.session));
                        }
                    } else {
                        self.snapshot = None;
                        self.discarded_snapshot = None;
                    }
                    self.pending_prompt = None;
                    self.pending_local.clear();
                }
                _ if self.pending_prompt.is_some() => self.pending_local.push(entry.clone()),
                _ => {}
            }
        }
        if let Message::ToServer(ToServerMessage::Acp(acp)) = &entry.content {
            if let RawJsonRpcMessage::Response(response) = &acp.0 {
                let id = match response {
                    Response::Result { id, .. } | Response::Error { id, .. } => id,
                };
                if self.pending_prompt.as_ref() == Some(id) {
                    self.pending_prompt = None;
                    self.pending_local.clear();
                    if self.snapshot.take().is_some() {
                        self.quarantined = true;
                        return Outcome::Changes(committed.step(entry));
                    }
                }
            }
            if let RawJsonRpcMessage::Notification(notification) = &acp.0
                && HistorySnapshotNotification::matches_method(&notification.method)
            {
                let Some(RawJsonRpcParams::Object(params)) = notification.params.as_ref() else {
                    return Outcome::Staged;
                };
                let Ok(fact) =
                    HistorySnapshotNotification::parse_message(&notification.method, params)
                else {
                    return Outcome::Staged;
                };
                if self.candidate.is_some() || self.discarded_snapshot.is_some() {
                    let scope = (fact.snapshot_id, fact.session_id.to_string());
                    match fact.phase {
                        HistorySnapshotPhase::Begin => self.discarded_snapshot = Some(scope),
                        HistorySnapshotPhase::Commit => {
                            if self.discarded_snapshot.as_ref() == Some(&scope) {
                                self.discarded_snapshot = None;
                            }
                        }
                    }
                    return Outcome::Staged;
                }
                if self.disconnected || self.quarantined {
                    return Outcome::Staged;
                }
                match fact.phase {
                    HistorySnapshotPhase::Begin => {
                        self.snapshot = Some(Snapshot {
                            id: fact.snapshot_id,
                            session: fact.session_id.to_string(),
                            state: FoldState {
                                metadata: committed.metadata.clone(),
                                replaying: true,
                                ..FoldState::default()
                            },
                        });
                    }
                    HistorySnapshotPhase::Commit => {
                        if self.snapshot.as_ref().is_some_and(|snapshot| {
                            snapshot.id == fact.snapshot_id
                                && snapshot.session == fact.session_id.to_string()
                        }) {
                            let mut snapshot = self.snapshot.take().expect("matched snapshot");
                            snapshot.state.replaying = false;
                            for local in &self.pending_local {
                                snapshot.state.step(local.clone());
                            }
                            *committed = snapshot.state;
                            return Outcome::Replaced;
                        }
                    }
                }
                return Outcome::Staged;
            }
        }
        if let Some((_, session)) = &self.discarded_snapshot
            && let Message::ToServer(ToServerMessage::Acp(acp)) = &entry.content
        {
            let params = match &acp.0 {
                RawJsonRpcMessage::Notification(n) => Some(n.params.as_ref()),
                RawJsonRpcMessage::Request(r) => Some(r.params.as_ref()),
                RawJsonRpcMessage::Response(_) => None,
            };
            if let Some(params) = params
                && param(params, "sessionId")
                    .and_then(|v| v.as_str())
                    .is_none_or(|id| id == session)
            {
                return Outcome::Staged;
            }
        }
        if let Some(snapshot) = &mut self.snapshot {
            match &entry.content {
                Message::ToServer(ToServerMessage::Acp(acp)) => {
                    let params = match &acp.0 {
                        RawJsonRpcMessage::Notification(n) => n.params.as_ref(),
                        RawJsonRpcMessage::Request(r) => r.params.as_ref(),
                        _ => None,
                    };
                    if param(params, "sessionId")
                        .and_then(|v| v.as_str())
                        .is_none_or(|session| session == snapshot.session)
                    {
                        snapshot.state.step(entry);
                    }
                    return Outcome::Staged;
                }
                Message::ToRuntime(_) => return Outcome::Staged,
                _ => {}
            }
        }

        if let Message::ToServer(ToServerMessage::Event { event }) = &entry.content {
            if matches!(event, SystemEvent::AcpReady | SystemEvent::Disconnected) {
                self.quarantined |= self.candidate.is_some()
                    || self.snapshot.is_some()
                    || matches!(event, SystemEvent::Disconnected);
                self.snapshot = None;
                self.discarded_snapshot = None;
                self.pending_prompt = None;
                self.pending_local.clear();
                self.candidate = None;
                self.pending_open = None;
                self.initialization = FoldState::default();
                self.disconnected = matches!(event, SystemEvent::Disconnected);
                committed.clear_pending();
            }
            self.initialization.step(entry.clone());
            if let Some(candidate) = &mut self.candidate {
                candidate.state.step(entry.clone());
            }
            return Outcome::Changes(committed.step(entry));
        }
        if let Message::ToRuntime(ToRuntimeMessage::Acp(acp)) = &entry.content
            && let RawJsonRpcMessage::Request(request) = &acp.0
        {
            if InitializeRequest::matches_method(&request.method) {
                // Initialization starts a correlation epoch, but does not
                // erase committed messages or imply a successful restore.
                self.quarantined |= self.candidate.is_some();
                self.candidate = None;
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
                let mut state = FoldState {
                    metadata: self.initialization.metadata.clone(),
                    replaying: true,
                    ..FoldState::default()
                };
                state.step(entry.clone());
                self.pending_open = None;
                self.replay_session = Some(session.to_owned());
                self.candidate = Some(Candidate {
                    request: request.id.clone(),
                    session: session.to_owned(),
                    state,
                });
                return Outcome::Staged;
            } else if !self.disconnected
                && self.quarantined
                && self.candidate.is_none()
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
                if self.candidate.is_none() {
                    return Outcome::Changes(committed.step(entry));
                }
            }
            if self
                .candidate
                .as_ref()
                .is_some_and(|candidate| &candidate.request == id)
            {
                let mut candidate = self.candidate.take().expect("matched candidate");
                // Match SessionMachine::on_session_opened exactly: JSON-RPC
                // success alone is insufficient; the ACP result must decode.
                if !matches!(response, Response::Result { result, .. }
                    if LoadSessionResponse::from_value(AGENT_METHOD_NAMES.session_load, result.clone()).is_ok())
                {
                    self.quarantined = true;
                    return Outcome::Staged;
                }
                self.quarantined = false;
                candidate.state.step(entry);
                // Load completion is not turn completion. Keep the last replayed
                // turn open so live chunks after the high-water mark append to it.
                candidate.state.replaying = false;
                *committed = candidate.state;
                return Outcome::Replaced;
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
        if let Some(candidate) = &mut self.candidate {
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
            candidate.state.step(entry);
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
