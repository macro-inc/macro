//! A fake agent process, speaking only raw ACP.

use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    ClientNotification, ClientRequest, InitializeResponse, NewSessionResponse, RequestId,
};
use agent_client_protocol::{
    Error as AcpError, JsonRpcMessage, JsonRpcNotification, JsonRpcResponse, RawJsonRpcMessage,
};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;

#[cfg(test)]
mod test;

/// How far through the ACP handshake this agent believes the harness has got.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Stage {
    #[default]
    Fresh,
    Initialized,
    SessionOpen,
}

#[derive(Default)]
struct Progress {
    stage: Stage,
    /// Requests received and not yet answered.
    initializing: Option<RequestId>,
    opening: Option<RequestId>,
}

/// Parse a frame into whichever ACP message enum the caller asked for.
fn parse<T: JsonRpcMessage>(method: &str, params: &impl serde::Serialize) -> T {
    T::parse_message(method, params)
        .unwrap_or_else(|error| panic!("{method} did not parse as ACP: {error}"))
}

/// The agent inside a container. Speaks raw ACP only, like the real sidecar;
/// the container wraps its frames for the wire. Cloning shares one agent.
#[derive(Clone)]
pub struct FakeAgent {
    /// `None` once the container has disconnected.
    to_harness: Arc<Mutex<Option<UnboundedSender<RawJsonRpcMessage>>>>,
    received: watch::Sender<Vec<RawJsonRpcMessage>>,
    progress: Arc<Mutex<Progress>>,
}

impl FakeAgent {
    pub(crate) fn new(to_harness: UnboundedSender<RawJsonRpcMessage>) -> Self {
        let (received, _) = watch::channel(Vec::new());
        Self {
            to_harness: Arc::new(Mutex::new(Some(to_harness))),
            received,
            progress: Arc::new(Mutex::new(Progress::default())),
        }
    }

    /// Answer a request the harness sent. [`serde_json::Value`] also satisfies
    /// the bound, for testing a malformed agent.
    pub fn sends_reply<R>(&self, id: RequestId, response: R)
    where
        R: JsonRpcResponse + serde::Serialize,
    {
        let result = serde_json::to_value(&response).expect("a response should serialize");
        {
            let mut progress = self.lock_progress();
            if progress.opening.as_ref() == Some(&id) {
                progress.opening = None;
                progress.stage = Stage::SessionOpen;
            }
        }
        self.send(RawJsonRpcMessage::response(id, Ok(result)));
    }

    /// Answer the `initialize` this agent received.
    ///
    /// # Panics
    ///
    /// If the harness has not sent one.
    pub fn completes_initialize(&self, response: InitializeResponse) {
        let id = {
            let mut progress = self.lock_progress();
            let id = progress
                .initializing
                .take()
                .expect("the harness has not sent initialize");
            progress.stage = Stage::Initialized;
            id
        };
        self.sends_reply(id, response);
    }

    /// Answer the `session/new` this agent received, opening its ACP session.
    ///
    /// # Panics
    ///
    /// If the harness has not sent one.
    pub fn opens_session(&self, response: NewSessionResponse) {
        let id = self
            .lock_progress()
            .opening
            .clone()
            .expect("the harness has not sent session/new");
        self.sends_reply(id, response);
    }

    /// Refuse the `session/new` this agent received.
    ///
    /// # Panics
    ///
    /// If the harness has not sent one.
    pub fn refuses_session(&self, error: AcpError) {
        let id = self
            .lock_progress()
            .opening
            .clone()
            .expect("the harness has not sent session/new");
        self.sends_error(id, error);
    }

    /// Fail a request the harness sent.
    pub fn sends_error(&self, id: RequestId, error: AcpError) {
        self.send(RawJsonRpcMessage::response(id, Err(error)));
    }

    /// Volunteer a notification, as the agent does while working.
    pub fn sends_notification<N>(&self, notification: N)
    where
        N: JsonRpcNotification + serde::Serialize,
    {
        let method = notification.method().to_owned();
        let params = serde_json::to_value(&notification).expect("a notification should serialize");
        self.send(
            RawJsonRpcMessage::notification(method, params)
                .expect("notification params should be a JSON object or array"),
        );
    }

    /// Send an arbitrary frame, for testing an agent that misbehaves.
    pub fn sends_raw(&self, frame: RawJsonRpcMessage) {
        self.send(frame);
    }

    /// Every frame the harness has delivered, in order.
    #[must_use]
    pub fn received_frames(&self) -> Vec<RawJsonRpcMessage> {
        self.received.borrow().clone()
    }

    /// The requests the harness invoked, in order.
    #[must_use]
    pub fn received_requests(&self) -> Vec<ClientRequest> {
        self.received
            .borrow()
            .iter()
            .filter_map(|frame| match frame {
                RawJsonRpcMessage::Request(request) => {
                    Some(parse(&request.method, &request.params))
                }
                RawJsonRpcMessage::Notification(_) | RawJsonRpcMessage::Response(_) => None,
            })
            .collect()
    }

    /// Wait until the harness has delivered at least `count` ACP requests.
    pub async fn wait_for_requests(&self, count: usize) {
        let mut received = self.received.subscribe();
        received
            .wait_for(|frames| {
                frames
                    .iter()
                    .filter(|frame| matches!(frame, RawJsonRpcMessage::Request(_)))
                    .count()
                    >= count
            })
            .await
            .expect("fake agent frame history should remain open");
    }

    /// The notifications the harness sent, in order.
    #[must_use]
    pub fn received_notifications(&self) -> Vec<ClientNotification> {
        self.received
            .borrow()
            .iter()
            .filter_map(|frame| match frame {
                RawJsonRpcMessage::Notification(notification) => {
                    Some(parse(&notification.method, &notification.params))
                }
                RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Response(_) => None,
            })
            .collect()
    }

    /// Record a frame the harness sent this agent.
    ///
    /// # Panics
    ///
    /// If the harness speaks out of ACP order - a session-scoped request before
    /// its session exists, or `session/new` before `initialize`. A real agent
    /// would reject these, so failing loudly beats recording them.
    pub(crate) fn deliver(&self, frame: RawJsonRpcMessage) {
        if let RawJsonRpcMessage::Request(request) = &frame {
            let mut progress = self.lock_progress();
            match parse::<ClientRequest>(&request.method, &request.params) {
                ClientRequest::InitializeRequest(_) => {
                    progress.initializing = Some(request.id.clone());
                }
                ClientRequest::NewSessionRequest(_) | ClientRequest::LoadSessionRequest(_) => {
                    assert_eq!(
                        progress.stage,
                        Stage::Initialized,
                        "harness sent {} before initialize completed",
                        request.method
                    );
                    progress.opening = Some(request.id.clone());
                }
                other => assert_eq!(
                    progress.stage,
                    Stage::SessionOpen,
                    "harness sent {} before its ACP session existed: {other:?}",
                    request.method
                ),
            }
        }
        self.received.send_modify(|frames| frames.push(frame));
    }

    /// Stop being able to talk, so the harness sees the stream end.
    pub(crate) fn close(&self) {
        self.to_harness
            .lock()
            .expect("fake agent sender lock should not be poisoned")
            .take();
    }

    fn send(&self, frame: RawJsonRpcMessage) {
        if let Some(to_harness) = self
            .to_harness
            .lock()
            .expect("fake agent sender lock should not be poisoned")
            .as_ref()
        {
            let _ = to_harness.send(frame);
        }
    }

    fn lock_progress(&self) -> std::sync::MutexGuard<'_, Progress> {
        self.progress
            .lock()
            .expect("fake agent progress lock should not be poisoned")
    }
}
