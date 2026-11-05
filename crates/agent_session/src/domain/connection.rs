//! One runtime connection, shared by every session it carries.
//!
//! ACP initializes per connection rather than per session, and a `sessionId`
//! on every session-scoped method is what lets one connection carry many. So
//! the transport belongs here rather than to any one session: this owns the
//! socket, decides which session each inbound frame belongs to, and holds the
//! handshake result for sessions that bind long after it completed.
//!
//! Sessions still see a [`Transport`]. [`RuntimeConnection::bind`] hands each
//! one a [`SessionChannel`] - sends go out on the shared socket tagged with
//! their owner, receives read only that session's frames - so the actor and
//! machine above are unchanged by sharing.
//!
//! Routing is the part that has to be exact. Every inbound frame is logged to
//! a session's transcript, which is that session's durable history, so a
//! misrouted frame is not a delivery bug but a corrupted record. Three things
//! decide an owner: a response matches the session whose request it answers, a
//! session-scoped request or notification matches the session holding that ACP
//! session id, and system events belong to the connection itself.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use agent_client_protocol::schema::v1::{
    InitializeResponse, ListSessionsRequest, ListSessionsResponse, McpServer, RequestId, Response,
    SessionId,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_runtime_protocol::domain::ports::{
    Transport, TransportError, TransportReceiver, TransportSender,
};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, ComputerCommand, ComputerControlResult, ModelProbeResult, SystemEvent,
    ToRuntimeMessage, ToServerMessage,
};
use dashmap::DashMap;
use tokio::sync::{Mutex, mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

use crate::domain::model::{AgentSessionId, SessionClaim};
use crate::domain::session::{
    HandshakeStatus, InitializationContext, PermissionPolicy, SessionRestoreSupport,
};

#[cfg(test)]
mod test;

/// Inbound frames buffered per session before the router applies backpressure.
///
/// Bounded rather than lossy on purpose: a dropped frame is a hole in a
/// session's transcript, so a session that cannot keep up slows the router
/// instead of losing history.
const SESSION_INBOUND_BUFFER: usize = 1028;

/// What the router decided to do with one inbound frame.
///
/// Named so the routing rules can be tested without a socket, a session, or
/// an actor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Routed {
    /// Deliver to exactly one session.
    Session(AgentSessionId),
    /// The whole connection's business: a system event, or its end.
    Connection,
    /// A connection-level model probe response, never session traffic.
    Probe,
    /// The answer to a computer control command.
    Computer,
    /// The answer to a request the connection itself sent.
    Answer,
    /// Nothing owns it. Kept as its own answer rather than folded into
    /// `Connection` so it can be counted and logged as the anomaly it is.
    Orphan,
}

/// Which session each in-flight request and live ACP session belongs to.
///
/// Separate from the connection so the rules can be exercised directly.
#[derive(Debug, Default)]
pub(crate) struct Routes {
    requests: HashMap<RequestId, AgentSessionId>,
    connection_requests: HashSet<RequestId>,
    acp_sessions: HashMap<SessionId, AgentSessionId>,
}

impl Routes {
    /// Remember that `session` is awaiting an answer to `request`.
    pub(crate) fn expect_response(&mut self, request: RequestId, session: AgentSessionId) {
        self.requests.insert(request, session);
    }

    /// Remember that the connection itself is awaiting an answer to `request`.
    pub(crate) fn expect_connection_response(&mut self, request: RequestId) {
        self.connection_requests.insert(request);
    }

    /// Remember that `acp_session` is `session`'s session on the agent.
    pub(crate) fn bind_acp_session(&mut self, acp_session: SessionId, session: AgentSessionId) {
        self.acp_sessions.insert(acp_session, session);
    }

    /// Forget everything about a session that is over.
    pub(crate) fn forget(&mut self, session: AgentSessionId) {
        self.requests.retain(|_, owner| *owner != session);
        self.acp_sessions.retain(|_, owner| *owner != session);
    }

    /// Who owns this frame.
    ///
    /// A response is claimed by whoever is waiting for it, and the
    /// expectation is consumed - a second answer to one request has no owner.
    /// Anything carrying a `sessionId` belongs to that ACP session's owner.
    pub(crate) fn route(&mut self, message: &ToServerMessage) -> Routed {
        if matches!(message, ToServerMessage::ModelProbeResponse { .. }) {
            return Routed::Probe;
        }
        if matches!(message, ToServerMessage::ComputerControlResponse { .. }) {
            return Routed::Computer;
        }
        let ToServerMessage::Acp(AcpMessage(frame)) = message else {
            return Routed::Connection;
        };

        if let Some(id) = frame.response_id() {
            if let Some(session) = self.requests.remove(id) {
                return Routed::Session(session);
            }
            if self.connection_requests.remove(id) {
                return Routed::Answer;
            }
            return Routed::Orphan;
        }

        match acp_session_of(frame).and_then(|acp| self.acp_sessions.get(&acp)) {
            Some(session) => Routed::Session(*session),
            None => Routed::Orphan,
        }
    }
}

/// The ACP session a frame names, when it names one.
///
/// Read out of the raw params rather than by deserializing each request type:
/// every session-scoped method carries `sessionId` at the top level, and the
/// router only needs that one field.
fn acp_session_of(frame: &RawJsonRpcMessage) -> Option<SessionId> {
    let params = match frame {
        RawJsonRpcMessage::Request(request) => request.params.clone()?,
        RawJsonRpcMessage::Notification(notification) => notification.params.clone()?,
        RawJsonRpcMessage::Response(_) => return None,
    };
    let session_id = params.into_value().get("sessionId")?.as_str()?.to_owned();
    Some(SessionId::from(session_id))
}

/// A transport for one session, plus the handshake gate it shares with every
/// other session on the same connection.
///
/// Attaching needs both: the transport to carry the session's traffic, and the
/// gate so exactly one session per connection runs `initialize` and the rest
/// are told its result.
pub struct RuntimeAttachment<Connector> {
    pub(crate) activation: Option<AttachmentActivation>,
    pub(crate) connector: Connector,
    pub(crate) handshake: watch::Sender<HandshakeStatus>,
    /// MCP servers the agent is told to connect to when this attachment's
    /// session is established (`session/new`, `session/load`,
    /// `session/resume`).
    ///
    /// Per attachment rather than per session row because it is computed
    /// fresh at each attach - the set follows what the owner has connected
    /// *now*, not what they had connected when the session was created.
    pub(crate) mcp_servers: Vec<McpServer>,
    /// Cancelled by the connector the moment its transport ends, for
    /// connectors that can tell - most can, via whatever already tears their
    /// pipe or socket down. `None` for a connector with no such signal;
    /// callers waiting on a reply then fall back to their own timeout alone,
    /// exactly as before this existed.
    pub(crate) closed: Option<CancellationToken>,
    /// How this attachment's session answers permission requests. Per
    /// attachment for the same reason as `mcp_servers`: it follows what the
    /// agent's owner has configured *now*.
    pub(crate) permission_policy: PermissionPolicy,
    /// Model to select after creating a fresh ACP session, before any prompt.
    pub(crate) initial_model: Option<String>,
}

/// Activate attachment-owned resources with the exact acquired ownership claim.
pub type AttachmentActivation =
    Box<dyn FnOnce(SessionClaim) -> crate::domain::error::Result<()> + Send + Sync>;

impl<Connector> RuntimeAttachment<Connector> {
    /// A transport carrying exactly one session, so its handshake is its own.
    ///
    /// What a managed sandbox gets: one container, one session, nothing to
    /// share the connection with.
    pub fn solo(connector: Connector) -> Self {
        let (handshake, _) = watch::channel(HandshakeStatus::Pending);
        Self {
            activation: None,
            connector,
            handshake,
            mcp_servers: Vec::new(),
            closed: None,
            permission_policy: PermissionPolicy::default(),
            initial_model: None,
        }
    }

    /// Run once after ownership acquisition, before the session actor starts.
    #[must_use]
    pub fn on_activate(mut self, activation: AttachmentActivation) -> Self {
        self.activation = Some(activation);
        self
    }

    /// Wire up the connector's own transport-closed signal, when it has one.
    ///
    /// Lets a command waiting on this session's reply fail the moment the
    /// transport is known to be gone, rather than only once its own
    /// wall-clock timeout separately elapses.
    #[must_use]
    pub fn with_closed(mut self, closed: CancellationToken) -> Self {
        self.closed = Some(closed);
        self
    }

    /// Change the carrier without losing its handshake or activation lifecycle.
    pub fn map_transport<T>(self, map: impl FnOnce(Connector) -> T) -> RuntimeAttachment<T> {
        RuntimeAttachment {
            connector: map(self.connector),
            handshake: self.handshake,
            mcp_servers: self.mcp_servers,
            activation: self.activation,
            closed: self.closed,
            permission_policy: self.permission_policy,
            initial_model: self.initial_model,
        }
    }

    /// The MCP servers the agent is handed when this attachment's session is
    /// established.
    #[must_use]
    pub fn mcp_servers(mut self, mcp_servers: Vec<McpServer>) -> Self {
        self.mcp_servers = mcp_servers;
        self
    }

    /// Select this model before the first prompt of a newly created ACP session.
    /// Empty values and the provider-default sentinel keep the runtime's default.
    #[must_use]
    pub fn initial_model(mut self, model: String) -> Self {
        self.initial_model = (!model.trim().is_empty() && model != "default").then_some(model);
        self
    }

    /// How this attachment's session answers the agent's permission requests.
    #[must_use]
    pub fn permission_policy(mut self, permission_policy: PermissionPolicy) -> Self {
        self.permission_policy = permission_policy;
        self
    }
}

/// Every session this connection carries, and where to reach it.
type Bound = DashMap<AgentSessionId, mpsc::Sender<ToServerMessage>>;

/// The latest model probe answer, or `None` for "no answer is coming".
type ProbeAnswers = watch::Sender<Option<ModelProbeResult>>;

/// One runtime connection and the sessions riding on it.
///
/// Holds the carrier's sending half only: the receiving half belongs to the
/// router task, which is the sole reader of a connection by definition.
pub struct RuntimeConnection<Sender> {
    outbound: Sender,
    handshake: watch::Sender<HandshakeStatus>,
    /// Whether the runtime has reported its agent ready.
    ///
    /// Remembered rather than only relayed, because it arrives once and the
    /// sessions that need it mostly do not exist yet: a runtime dials, says
    /// ready, and only then does someone mention the bot. A session binding
    /// afterwards has to be able to learn it happened.
    runtime_ready: watch::Sender<bool>,
    bound: Bound,
    /// Answers to model probes, broadcast rather than correlated: every probe
    /// on this connection asks the same parameterless question, so any answer
    /// serves any waiter.
    probe_answers: ProbeAnswers,
    /// Waiters for answers to requests the connection itself sent: its
    /// `initialize` and `session/list`.
    answers: DashMap<RequestId, oneshot::Sender<RawJsonRpcMessage>>,
    /// Waiters for answers to computer control commands, by request id.
    computer_answers: DashMap<String, oneshot::Sender<ComputerControlResult>>,
    routes: Mutex<Routes>,
    router: OnceLock<tokio::task::AbortHandle>,
    /// Cancelled once this connection's transport has ended.
    ///
    /// A token rather than a notification because whoever waits on it mostly
    /// arrives late: a connection can die before anybody asks, and
    /// [`CancellationToken::cancelled`] on an already-cancelled token returns
    /// at once, where a missed notification would wait forever.
    closed: CancellationToken,
}

impl<Sender> RuntimeConnection<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    /// Take a dialed-in runtime's carrier apart and start serving it.
    ///
    /// The receiving half goes straight into the router task and is never
    /// stored, which is what makes "one reader" a fact about the code rather
    /// than a convention.
    pub fn connect<Carrier>(carrier: Carrier) -> Arc<Self>
    where
        Carrier: Transport<ToRuntimeMessage, ToServerMessage, Sender = Sender>,
    {
        let (outbound, inbound) = carrier.split();
        let (handshake, _) = watch::channel(HandshakeStatus::Pending);
        let connection = Arc::new(Self {
            outbound,
            handshake,
            runtime_ready: watch::channel(false).0,
            bound: DashMap::new(),
            probe_answers: watch::channel(None).0,
            answers: DashMap::new(),
            computer_answers: DashMap::new(),
            routes: Mutex::new(Routes::default()),
            router: OnceLock::new(),
            closed: CancellationToken::new(),
        });
        let router = tokio::spawn(Arc::clone(&connection).route_inbound(inbound));
        let _ = connection.router.set(router.abort_handle());
        connection
    }

    /// Stop serving this connection: it has been displaced by a newer dial.
    pub fn evict(&self) {
        self.bound.clear();
        self.answers.clear();
        self.computer_answers.clear();
        // Nothing will answer a probe on a connection that is no longer served.
        let _ = self.probe_answers.send(None);
        if let Some(router) = self.router.get() {
            router.abort();
        }
        // An aborted router will never reach the end of `route_inbound`, so
        // the signal is raised here too: whoever is waiting for this
        // connection to be over is waiting for either way of it ending.
        self.closed.cancel();
    }

    /// Resolves once this connection's transport has ended, however it ended.
    ///
    /// What a registry holding connections needs in order to stop handing out
    /// one that is closed: a socket dies with nothing to announce it, so the
    /// holder has to be told rather than discover it on the next send.
    pub async fn closed(&self) {
        self.closed.cancelled().await;
    }

    /// Ask the runtime to inspect a separate fresh ACP process and await the
    /// next answer this connection produces.
    ///
    /// Answers are not correlated to requests because they cannot disagree:
    /// the request has no parameters and the runtime hosts one configured
    /// harness, so concurrent probes are the same question asked twice.
    pub async fn probe_models(
        &self,
    ) -> Result<Vec<agent_client_protocol::schema::v1::SessionConfigOption>, ModelProbeError> {
        // Subscribe before asking: an answer can land before this task is
        // polled again, and a missed wakeup would wait for somebody else's
        // next probe.
        let mut answers = self.probe_answers.subscribe();
        answers.mark_unchanged();

        self.outbound
            .send(ToRuntimeMessage::ModelProbeRequest)
            .await
            .map_err(ModelProbeError::Transport)?;

        let answer = tokio::select! {
            changed = answers.changed() => {
                changed.map_err(|_| ModelProbeError::Closed)?;
                answers.borrow_and_update().clone()
            }
            () = self.closed.cancelled() => return Err(ModelProbeError::Closed),
        };
        match answer {
            Some(ModelProbeResult::Available { config_options }) => Ok(config_options),
            Some(ModelProbeResult::Error { message }) => Err(ModelProbeError::Runtime(message)),
            None => Err(ModelProbeError::Closed),
        }
    }

    /// Send a Macro computer command and await its one answer. The caller
    /// owns the deadline.
    pub async fn computer_control(
        &self,
        command: ComputerCommand,
    ) -> Result<ComputerControlResult, ComputerControlError> {
        let request_id = uuid::Uuid::now_v7().to_string();
        let (answer, answered) = oneshot::channel();
        self.computer_answers.insert(request_id.clone(), answer);
        let _pending = PendingComputerAnswer {
            answers: &self.computer_answers,
            request_id: request_id.clone(),
        };
        let mut meta = serde_json::Map::new();
        genai_telemetry::propagation::inject(&tracing::Span::current(), &mut meta);
        let sent = self
            .outbound
            .send(ToRuntimeMessage::ComputerControl {
                request_id: request_id.clone(),
                command,
                meta,
            })
            .await;
        if let Err(error) = sent {
            self.computer_answers.remove(&request_id);
            return Err(ComputerControlError::Transport(error));
        }
        let answer = tokio::select! {
            answer = answered => answer.map_err(|_| ComputerControlError::Closed),
            () = self.closed.cancelled() => Err(ComputerControlError::Closed),
        };
        self.computer_answers.remove(&request_id);
        answer
    }

    /// Initialize the connection and list the ACP sessions its agent serves.
    ///
    /// Asked of every new connection: agents that outlived the previous one
    /// keep working, and nothing else would load their sessions until someone
    /// prompted them. Waits for the runtime to report ready, then runs the
    /// connection's one `initialize` and publishes it through the handshake
    /// every session shares - or, when a session already claimed it, waits
    /// for that one. An agent that does not advertise
    /// `sessionCapabilities.list` lists nothing. The caller owns the deadline.
    pub async fn list_sessions(&self) -> Result<Vec<SessionId>, ListSessionsError> {
        let mut ready = self.runtime_ready.subscribe();
        tokio::select! {
            ready = ready.wait_for(|ready| *ready) => {
                ready.map_err(|_| ListSessionsError::Closed)?;
            }
            () = self.closed.cancelled() => return Err(ListSessionsError::Closed),
        }
        let initialized = if self.claim_handshake() {
            let mut claim = HandshakeClaim {
                connection: self,
                held: true,
            };
            let initialized = self.initialize().await?;
            claim.held = false;
            initialized
        } else {
            self.shared_initialize().await?
        };
        if initialized
            .agent_capabilities
            .session_capabilities
            .list
            .is_none()
        {
            return Ok(Vec::new());
        }
        let mut sessions = Vec::new();
        let mut cursor = None;
        for _ in 0..MAX_SESSION_LIST_PAGES {
            let (method, params) = ListSessionsRequest::new()
                .cursor(cursor)
                .to_untyped_message()
                .map_err(|error| ListSessionsError::Runtime(error.to_string()))?
                .into_parts();
            let (_, result) = self.request(method, params).await?;
            let page = serde_json::from_value::<ListSessionsResponse>(result)
                .map_err(|error| ListSessionsError::Runtime(error.to_string()))?;
            sessions.extend(page.sessions.into_iter().map(|session| session.session_id));
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return Ok(sessions),
            }
        }
        Err(ListSessionsError::Runtime(
            "session/list did not end its pages".to_owned(),
        ))
    }

    /// Send this connection's `initialize` and publish its answer to every
    /// session on the connection, as a session that initialized would.
    async fn initialize(&self) -> Result<InitializeResponse, ListSessionsError> {
        let id = connection_request_id();
        let request = crate::domain::session::initialize_request(id.clone())
            .map_err(|error| ListSessionsError::Runtime(error.to_string()))?;
        let (response, result) = self.send_request(id, request.clone()).await?;
        let initialized = serde_json::from_value::<InitializeResponse>(result)
            .map_err(|error| ListSessionsError::Runtime(error.to_string()))?;
        self.handshake
            .send_replace(HandshakeStatus::ReadyWithContext {
                restore: SessionRestoreSupport::of(&initialized),
                context: Arc::new(InitializationContext {
                    request: ToRuntimeMessage::Acp(AcpMessage(request)),
                    response: ToServerMessage::Acp(AcpMessage(response)),
                }),
            });
        Ok(initialized)
    }

    /// The `initialize` answer a session on this connection received.
    async fn shared_initialize(&self) -> Result<InitializeResponse, ListSessionsError> {
        let mut handshake = self.handshake.subscribe();
        let context = tokio::select! {
            status = handshake.wait_for(|status| matches!(status, HandshakeStatus::ReadyWithContext { .. })) => {
                let status = status.map_err(|_| ListSessionsError::Closed)?;
                let HandshakeStatus::ReadyWithContext { context, .. } = &*status else {
                    unreachable!("waited for a ready handshake")
                };
                Arc::clone(context)
            }
            () = self.closed.cancelled() => return Err(ListSessionsError::Closed),
        };
        let ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::Response(Response::Result {
            result,
            ..
        }))) = &context.response
        else {
            return Err(ListSessionsError::Runtime(
                "the shared handshake has no initialize result".to_owned(),
            ));
        };
        serde_json::from_value::<InitializeResponse>(result.clone())
            .map_err(|error| ListSessionsError::Runtime(error.to_string()))
    }

    /// Send a request of the connection's own and await its result.
    async fn request(
        &self,
        method: String,
        params: serde_json::Value,
    ) -> Result<(RawJsonRpcMessage, serde_json::Value), ListSessionsError> {
        let id = connection_request_id();
        let request = RawJsonRpcMessage::request(method, params, id.clone())
            .map_err(|error| ListSessionsError::Runtime(error.to_string()))?;
        self.send_request(id, request).await
    }

    async fn send_request(
        &self,
        id: RequestId,
        request: RawJsonRpcMessage,
    ) -> Result<(RawJsonRpcMessage, serde_json::Value), ListSessionsError> {
        let (answered, answer) = oneshot::channel();
        self.answers.insert(id.clone(), answered);
        self.routes
            .lock()
            .await
            .expect_connection_response(id.clone());
        if let Err(error) = self
            .outbound
            .send(ToRuntimeMessage::Acp(AcpMessage(request)))
            .await
        {
            self.answers.remove(&id);
            return Err(ListSessionsError::Transport(error));
        }
        let answer = tokio::select! {
            answer = answer => answer.map_err(|_| ListSessionsError::Closed)?,
            () = self.closed.cancelled() => return Err(ListSessionsError::Closed),
        };
        match &answer {
            RawJsonRpcMessage::Response(Response::Result { result, .. }) => {
                let result = result.clone();
                Ok((answer, result))
            }
            RawJsonRpcMessage::Response(Response::Error { error, .. }) => {
                Err(ListSessionsError::Runtime(error.message.clone()))
            }
            _ => Err(ListSessionsError::Runtime("not a response".to_owned())),
        }
    }

    /// Give a handshake this connection claimed but did not finish back to
    /// the sessions: the first one bound takes it over, as on readiness.
    fn release_handshake(&self) {
        self.handshake.send_replace(HandshakeStatus::Pending);
        let waiting = self.bound.iter().next().map(|entry| entry.value().clone());
        if let Some(inbound) = waiting
            && self.claim_handshake()
            && inbound
                .try_send(ToServerMessage::Event {
                    event: SystemEvent::AcpReady,
                })
                .is_err()
        {
            tracing::warn!("a session could not take over this connection's handshake");
        }
    }

    /// The gate every session on this connection shares.
    pub fn handshake(&self) -> watch::Sender<HandshakeStatus> {
        self.handshake.clone()
    }

    /// Give `session` its own view of this connection.
    ///
    /// Rebinding replaces: the newest view receives this session's frames, and
    /// whatever the displaced one was still waiting for is forgotten. That is
    /// what makes a session whose actor died recoverable - it binds again and
    /// the stale queue goes with it - and it is why a caller that already has a
    /// live actor must not call this.
    pub async fn bind(
        self: &Arc<Self>,
        session: AgentSessionId,
    ) -> RuntimeAttachment<SessionChannel<Sender>> {
        let (inbound, frames) = mpsc::channel(SESSION_INBOUND_BUFFER);
        if self.bound.insert(session, inbound).is_some() {
            self.routes.lock().await.forget(session);
        }
        // A runtime that reported ready before anyone was here to hear it
        // said so exactly once. Whoever binds first inherits the job.
        if self.claim_handshake() {
            let _ = inbound_of(&self.bound, session)
                .send(ToServerMessage::Event {
                    event: SystemEvent::AcpReady,
                })
                .await;
        }

        RuntimeAttachment {
            activation: None,
            connector: SessionChannel {
                connection: Arc::clone(self),
                session,
                frames,
            },
            handshake: self.handshake.clone(),
            // External runtimes hold no egress environment; the sessions
            // they serve are not handed proxied MCP servers.
            mcp_servers: Vec::new(),
            // This connection already tracks its own end (`evict`, or the
            // router task finishing) - the same signal `closed()` awaits.
            closed: Some(self.closed.clone()),
            // The caller knows whose agent this is; the connection does not.
            permission_policy: PermissionPolicy::default(),
            initial_model: None,
        }
    }

    /// Send on behalf of `session`, recording what it expects back.
    async fn send_for(
        &self,
        session: AgentSessionId,
        message: ToRuntimeMessage,
    ) -> std::result::Result<(), TransportError> {
        // Recorded before the send: the answer can arrive the instant the
        // frame lands, and a response nobody claims is an orphan.
        if let ToRuntimeMessage::Acp(AcpMessage(frame)) = &message {
            let mut routes = self.routes.lock().await;
            if let RawJsonRpcMessage::Request(request) = frame {
                routes.expect_response(request.id.clone(), session);
            }
            // A request naming an ACP session is also where that session's
            // ownership is established. It has to be, for the ones that
            // matter: `session/resume` and `session/load` name the session
            // going out and their answers do not echo it back, so the
            // outbound frame is the only place it is ever stated.
            if let Some(acp) = acp_session_of(frame) {
                routes.bind_acp_session(acp, session);
            }
        }
        self.outbound.send(message).await
    }

    /// Pump the shared transport, handing each frame to its session.
    ///
    /// Ends when the transport does, closing every session's queue - which
    /// each session's actor reads as its connection ending.
    async fn route_inbound(self: Arc<Self>, mut inbound: impl TransportReceiver<ToServerMessage>) {
        loop {
            let message = match inbound.recv().await {
                Ok(Some(message)) => message,
                Ok(None) => break,
                Err(error) => {
                    tracing::error!(error = ?error, "runtime connection transport failed");
                    break;
                }
            };

            // A session's opening response is where its ACP session id first
            // appears, and every later frame for it routes on that id.
            let routed = self.routes.lock().await.route(&message);
            if let Routed::Session(session) = routed
                && let ToServerMessage::Acp(AcpMessage(frame)) = &message
                && let Some(acp) = opened_acp_session(frame)
            {
                self.routes.lock().await.bind_acp_session(acp, session);
            }

            match routed {
                Routed::Session(session) => self.deliver(session, message).await,
                Routed::Connection => self.on_connection_message(message).await,
                Routed::Probe => self.answer_probes(message),
                Routed::Computer => self.answer_computer(message),
                Routed::Answer => self.answer(message),
                Routed::Orphan => {
                    tracing::warn!(
                        frame = ?message,
                        "dropping a runtime frame no session on this connection owns"
                    );
                }
            }
        }
        self.bound.clear();
        self.answers.clear();
        self.computer_answers.clear();
        self.closed.cancel();
    }

    /// Hand a computer control answer to the command waiting for it.
    fn answer_computer(&self, message: ToServerMessage) {
        let ToServerMessage::ComputerControlResponse { request_id, result } = message else {
            tracing::error!("dropping a computer answer that is not a computer control response");
            return;
        };
        match self.computer_answers.remove(&request_id) {
            Some((_, waiter)) => {
                let _ = waiter.send(result);
            }
            None => tracing::warn!(%request_id, "dropping an unexpected computer control answer"),
        }
    }

    /// Hand an answer to the connection request waiting for it.
    fn answer(&self, message: ToServerMessage) {
        let ToServerMessage::Acp(AcpMessage(frame)) = message else {
            tracing::error!("dropping a connection answer that is not an ACP response");
            return;
        };
        let Some((_, waiter)) = frame.response_id().and_then(|id| self.answers.remove(id)) else {
            return;
        };
        let _ = waiter.send(frame);
    }

    /// Hand one answer to every probe waiting on this connection. An answer
    /// nobody is waiting for is simply the last one, and is dropped.
    fn answer_probes(&self, message: ToServerMessage) {
        let ToServerMessage::ModelProbeResponse { result } = message else {
            unreachable!("only model probe responses receive probe routing")
        };
        let _ = self.probe_answers.send(Some(result));
    }

    async fn deliver(&self, session: AgentSessionId, message: ToServerMessage) {
        let Some(inbound) = self.bound.get(&session).map(|entry| entry.clone()) else {
            tracing::warn!(%session, "a frame arrived for a session that has gone");
            return;
        };
        if inbound.send(message).await.is_err() {
            self.bound.remove(&session);
        }
    }

    /// A connection-level message: readiness goes to one session, everything
    /// else to all of them.
    ///
    /// Readiness is a job, not news. Handing it to every session would have
    /// each of them send its own `initialize` on a connection that takes
    /// exactly one, so it goes to whichever session claims the handshake -
    /// and if none is bound yet, it waits in `runtime_ready` for one to be.
    async fn on_connection_message(&self, message: ToServerMessage) {
        if !matches!(
            message,
            ToServerMessage::Event {
                event: SystemEvent::AcpReady
            }
        ) {
            self.broadcast(message).await;
            return;
        }

        self.runtime_ready.send_replace(true);
        let waiting = self
            .bound
            .iter()
            .next()
            .map(|entry| (*entry.key(), entry.value().clone()));
        match waiting {
            Some((session, inbound)) if self.claim_handshake() => {
                if inbound.send(message).await.is_err() {
                    self.bound.remove(&session);
                }
            }
            _ => tracing::debug!("the runtime is ready; the next session to bind will initialize"),
        }
    }

    /// Take the handshake if it is going spare, once the runtime can serve it.
    ///
    /// The move from `Pending` to `InFlight` is the claim itself, so two
    /// sessions binding at once cannot both decide they are the one.
    fn claim_handshake(&self) -> bool {
        if !*self.runtime_ready.borrow() {
            return false;
        }
        let mut claimed = false;
        self.handshake.send_if_modified(|status| {
            if matches!(status, HandshakeStatus::Pending) {
                *status = HandshakeStatus::InFlight;
                claimed = true;
            }
            claimed
        });
        claimed
    }

    /// Hand a connection-level message to every session on it.
    async fn broadcast(&self, message: ToServerMessage) {
        let targets: Vec<_> = self
            .bound
            .iter()
            .map(|entry| (*entry.key(), entry.value().clone()))
            .collect();
        for (session, inbound) in targets {
            if inbound.send(message.clone()).await.is_err() {
                self.bound.remove(&session);
            }
        }
    }
}

/// Why a runtime could not list the sessions it serves.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ListSessionsError {
    /// Sending a request over the runtime transport failed.
    #[error("could not ask the runtime for its sessions: {0}")]
    Transport(#[source] TransportError),
    /// The runtime connection closed before answering.
    #[error("runtime connection closed before listing its sessions")]
    Closed,
    /// The runtime refused or answered something unreadable.
    #[error("runtime could not list its sessions: {0}")]
    Runtime(String),
}

/// Pages of `session/list` read before an agent is assumed to loop.
const MAX_SESSION_LIST_PAGES: usize = 100;

fn connection_request_id() -> RequestId {
    RequestId::Str(format!(
        "macro-connection-{}",
        macro_uuid::generate_uuid_v7()
    ))
}

/// A handshake [`RuntimeConnection::list_sessions`] claimed; given back to
/// the sessions if the initialize it started never finishes.
struct HandshakeClaim<'connection, Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    connection: &'connection RuntimeConnection<Sender>,
    held: bool,
}

impl<Sender> Drop for HandshakeClaim<'_, Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    fn drop(&mut self) {
        if self.held {
            self.connection.release_handshake();
        }
    }
}

/// A connection-level model probe failure.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ModelProbeError {
    /// Sending the request over the runtime transport failed.
    #[error("could not send model probe request: {0}")]
    Transport(#[source] TransportError),
    /// The runtime connection closed before answering.
    #[error("runtime connection closed before answering the model probe")]
    Closed,
    /// The runtime safely reported a probe failure.
    #[error("runtime model probe failed: {0}")]
    Runtime(String),
}

struct PendingComputerAnswer<'connection> {
    answers: &'connection DashMap<String, oneshot::Sender<ComputerControlResult>>,
    request_id: String,
}

impl Drop for PendingComputerAnswer<'_> {
    fn drop(&mut self) {
        self.answers.remove(&self.request_id);
    }
}

/// Why a computer control command got no answer.
#[derive(Debug, thiserror::Error)]
pub enum ComputerControlError {
    /// Sending the command over the runtime transport failed.
    #[error("could not send computer control command: {0}")]
    Transport(#[source] TransportError),
    /// The runtime connection closed before answering.
    #[error("runtime connection closed before answering the computer command")]
    Closed,
}

/// A bound session's queue. Only called just after inserting it.
fn inbound_of(bound: &Bound, session: AgentSessionId) -> mpsc::Sender<ToServerMessage> {
    bound
        .get(&session)
        .map(|entry| entry.clone())
        .expect("the session was just bound")
}

/// The ACP session id an opening response announces, when it is one.
fn opened_acp_session(frame: &RawJsonRpcMessage) -> Option<SessionId> {
    let RawJsonRpcMessage::Response(Response::Result { result, .. }) = frame else {
        return None;
    };
    let session_id = result.get("sessionId")?.as_str()?.to_owned();
    Some(SessionId::from(session_id))
}

/// One session's view of a shared connection.
///
/// A [`Transport`] like any other, so the actor above cannot tell whether it
/// has a socket to itself.
pub struct SessionChannel<Sender> {
    connection: Arc<RuntimeConnection<Sender>>,
    session: AgentSessionId,
    frames: mpsc::Receiver<ToServerMessage>,
}

/// One session's sending half: the shared carrier, plus whose traffic this is.
///
/// Every send goes out tagged with its session, which is how a response coming
/// back is attributed to the session that asked for it.
pub struct SessionSender<Sender> {
    connection: Arc<RuntimeConnection<Sender>>,
    session: AgentSessionId,
}

impl<Sender> Transport<ToRuntimeMessage, ToServerMessage> for SessionChannel<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    type Sender = SessionSender<Sender>;
    type Receiver = mpsc::Receiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (
            SessionSender {
                connection: self.connection,
                session: self.session,
            },
            self.frames,
        )
    }
}

impl<Sender> TransportSender<ToRuntimeMessage> for SessionSender<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        self.connection.send_for(self.session, message).await
    }
}
