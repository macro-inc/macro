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

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::{McpServer, RequestId, Response, SessionId};
use agent_runtime_protocol::domain::ports::{
    Transport, TransportError, TransportReceiver, TransportSender,
};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use dashmap::DashMap;
use tokio::sync::{Mutex, mpsc, watch};
use tokio_util::sync::CancellationToken;

use crate::domain::model::AgentSessionId;
use crate::domain::session::HandshakeStatus;

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
    acp_sessions: HashMap<SessionId, AgentSessionId>,
}

impl Routes {
    /// Remember that `session` is awaiting an answer to `request`.
    pub(crate) fn expect_response(&mut self, request: RequestId, session: AgentSessionId) {
        self.requests.insert(request, session);
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
        let ToServerMessage::Acp(AcpMessage(frame)) = message else {
            return Routed::Connection;
        };

        if let Some(id) = frame.response_id() {
            return match self.requests.remove(id) {
                Some(session) => Routed::Session(session),
                None => Routed::Orphan,
            };
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
}

impl<Connector> RuntimeAttachment<Connector> {
    /// A transport carrying exactly one session, so its handshake is its own.
    ///
    /// What a managed sandbox gets: one container, one session, nothing to
    /// share the connection with.
    pub fn solo(connector: Connector) -> Self {
        let (handshake, _) = watch::channel(HandshakeStatus::Pending);
        Self {
            connector,
            handshake,
            mcp_servers: Vec::new(),
        }
    }

    /// The MCP servers the agent is handed when this attachment's session is
    /// established.
    #[must_use]
    pub fn mcp_servers(mut self, mcp_servers: Vec<McpServer>) -> Self {
        self.mcp_servers = mcp_servers;
        self
    }
}

/// Every session this connection carries, and where to reach it.
type Bound = DashMap<AgentSessionId, mpsc::Sender<ToServerMessage>>;

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
    runtime_ready: AtomicBool,
    bound: Bound,
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
            runtime_ready: AtomicBool::new(false),
            bound: DashMap::new(),
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
            connector: SessionChannel {
                connection: Arc::clone(self),
                session,
                frames,
            },
            handshake: self.handshake.clone(),
            // External runtimes hold no egress environment; the sessions
            // they serve are not handed proxied MCP servers.
            mcp_servers: Vec::new(),
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
                Routed::Orphan => {
                    tracing::warn!(
                        frame = ?message,
                        "dropping a runtime frame no session on this connection owns"
                    );
                }
            }
        }
        self.bound.clear();
        self.closed.cancel();
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

        self.runtime_ready.store(true, Ordering::Release);
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
        if !self.runtime_ready.load(Ordering::Acquire) {
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
