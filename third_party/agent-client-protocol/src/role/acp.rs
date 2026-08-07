use std::{fmt::Debug, hash::Hash};

use crate::jsonrpc::{Builder, handlers::NullHandler, run::NullRun};
use crate::role::{HasPeer, RemoteStyle};
use crate::schema::v1::{InitializeRequest, NewSessionRequest, NewSessionResponse, SessionId};
use crate::schema::{InitializeProxyRequest, METHOD_INITIALIZE_PROXY};
use crate::util::MatchDispatchFrom;
use crate::{ConnectTo, ConnectionTo, Dispatch, HandleDispatchFrom, Handled, Role, RoleId};

/// The client role - typically an IDE or CLI that controls an agent.
///
/// Clients send prompts and receive responses from agents.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Client;

impl Role for Client {
    type Counterpart = Agent;

    fn builder(self) -> Builder<Self> {
        Builder::new(self).v1_client()
    }

    async fn default_handle_dispatch_from(
        &self,
        message: Dispatch,
        _connection: ConnectionTo<Client>,
    ) -> Result<Handled<Dispatch>, crate::Error> {
        Ok(Handled::No {
            message,
            retry: false,
        })
    }

    fn role_id(&self) -> RoleId {
        RoleId::from_singleton(self)
    }

    fn counterpart(&self) -> Self::Counterpart {
        Agent
    }
}

impl Client {
    /// Create a connection builder for a client.
    pub fn builder(self) -> Builder<Client, NullHandler, NullRun> {
        <Self as Role>::builder(self)
    }

    /// Create a client builder that requires an ACP protocol v2 agent.
    ///
    /// If the agent negotiates v1 during initialization, the initialize
    /// request resolves with an error so callers can choose an explicit v1
    /// fallback path.
    ///
    /// Requires the `unstable_protocol_v2` crate feature.
    #[cfg(feature = "unstable_protocol_v2")]
    pub fn v2(self) -> Builder<Client, NullHandler, NullRun> {
        self.builder().v2_client()
    }

    /// Connect to `agent` and run `main_fn` with the [`ConnectionTo`].
    /// Returns the result of `main_fn` (or an error if something goes wrong).
    ///
    /// Equivalent to `self.builder().connect_with(agent, main_fn)`.
    pub async fn connect_with<R>(
        self,
        agent: impl ConnectTo<Client>,
        main_fn: impl AsyncFnOnce(ConnectionTo<Agent>) -> Result<R, crate::Error>,
    ) -> Result<R, crate::Error> {
        self.builder().connect_with(agent, main_fn).await
    }
}

impl HasPeer<Client> for Client {
    fn remote_style(&self, _peer: Client) -> RemoteStyle {
        RemoteStyle::Counterpart
    }
}

/// The agent role - typically an LLM that responds to prompts.
///
/// Agents receive prompts from clients and respond with answers,
/// potentially invoking tools along the way.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Agent;

impl Role for Agent {
    type Counterpart = Client;

    fn builder(self) -> Builder<Self> {
        Builder::new(self).v1_agent()
    }

    fn role_id(&self) -> RoleId {
        RoleId::from_singleton(self)
    }

    fn counterpart(&self) -> Self::Counterpart {
        Client
    }

    async fn default_handle_dispatch_from(
        &self,
        message: Dispatch,
        connection: ConnectionTo<Agent>,
    ) -> Result<Handled<Dispatch>, crate::Error> {
        MatchDispatchFrom::new(message, &connection)
            .if_message_from(Agent, async |message: Dispatch| {
                // Subtle: messages that have a session-id field
                // should be captured by a dynamic message handler
                // for that session -- but there is a race condition
                // between the dynamic handler being added and
                // possible updates. Therefore, we "retry" all such
                // messages, so that they will be resent as new handlers
                // are added.
                let retry = message.has_session_id();
                Ok(Handled::No { message, retry })
            })
            .await
            .done()
    }
}

impl Agent {
    /// Create a connection builder for an agent.
    pub fn builder(self) -> Builder<Agent, NullHandler, NullRun> {
        <Self as Role>::builder(self)
    }

    /// Create an agent builder that uses the ACP protocol v2 API.
    ///
    /// The SDK will negotiate v1 or v2 during initialization and convert
    /// supported messages at the transport boundary, so handlers can be written
    /// against v2 types while still serving v1 clients.
    ///
    /// Requires the `unstable_protocol_v2` crate feature.
    #[cfg(feature = "unstable_protocol_v2")]
    pub fn v2(self) -> Builder<Agent, NullHandler, NullRun> {
        self.builder().v2_agent()
    }
}

impl HasPeer<Agent> for Agent {
    fn remote_style(&self, _peer: Agent) -> RemoteStyle {
        RemoteStyle::Counterpart
    }
}

/// The proxy role - an intermediary that can intercept and modify messages.
///
/// Proxies sit between a client and an agent (or another proxy), and can:
/// - Add tools via MCP servers
/// - Filter or transform messages
/// - Inject additional context
///
/// Proxies connect to a [`Conductor`] which orchestrates the proxy chain.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Proxy;

impl Role for Proxy {
    type Counterpart = Conductor;

    async fn default_handle_dispatch_from(
        &self,
        message: crate::Dispatch,
        _connection: crate::ConnectionTo<Self>,
    ) -> Result<crate::Handled<crate::Dispatch>, crate::Error> {
        Ok(Handled::No {
            message,
            retry: false,
        })
    }

    fn role_id(&self) -> RoleId {
        RoleId::from_singleton(self)
    }

    fn counterpart(&self) -> Self::Counterpart {
        Conductor
    }
}

impl Proxy {
    /// Create a connection builder for a proxy.
    pub fn builder(self) -> Builder<Proxy, NullHandler, NullRun> {
        Builder::new(self)
    }
}

impl HasPeer<Proxy> for Proxy {
    fn remote_style(&self, _peer: Proxy) -> RemoteStyle {
        RemoteStyle::Counterpart
    }
}

/// The conductor role - orchestrates proxy chains.
///
/// Conductors manage connections between clients, proxies, and agents,
/// routing messages through the appropriate proxy chain.
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Conductor;

impl Role for Conductor {
    type Counterpart = Proxy;

    fn role_id(&self) -> RoleId {
        RoleId::from_singleton(self)
    }

    fn counterpart(&self) -> Self::Counterpart {
        Proxy
    }

    async fn default_handle_dispatch_from(
        &self,
        message: Dispatch,
        cx: ConnectionTo<Conductor>,
    ) -> Result<Handled<Dispatch>, crate::Error> {
        // Handle various special messages:
        MatchDispatchFrom::new(message, &cx)
            .if_request_from(Client, async |_req: InitializeRequest, responder| {
                responder.respond_with_error(crate::Error::invalid_request().data(format!(
                    "proxies must be initialized with `{METHOD_INITIALIZE_PROXY}`"
                )))
            })
            .await
            // Initialize Proxy coming from the client -- forward to the agent but
            // convert into a regular initialize.
            .if_request_from(
                Client,
                async |request: InitializeProxyRequest, responder| {
                    let InitializeProxyRequest { initialize } = request;
                    cx.send_request_to(Agent, initialize)
                        .forward_response_to(responder)
                },
            )
            .await
            // New session coming from the client -- proxy to the agent
            // and add a dynamic handler for that session-id.
            .if_request_from(Client, async |request: NewSessionRequest, responder| {
                let sent = cx.send_request_to(Agent, request);
                // The dynamic-handler hook below means we cannot use
                // `forward_response_to`, so wire up cancellation forwarding
                // explicitly to keep `session/new` cancellable like every
                // other proxied request.
                let sent = sent.forward_cancellation_from(responder.cancellation());
                sent.on_receiving_result({
                    let cx = cx.clone();
                    async move |result| {
                        if let Ok(NewSessionResponse { session_id, .. }) = &result {
                            cx.add_dynamic_handler(ProxySessionMessages::new(session_id.clone()))?
                                .run_indefinitely();
                        }
                        responder.respond_with_result(result)
                    }
                })
            })
            .await
            // Incoming message from the client -- forward to the agent
            .if_message_from(Client, async |message: Dispatch| {
                cx.send_proxied_message_to(Agent, message)
            })
            .await
            // Incoming message from the agent -- forward to the client
            .if_message_from(Agent, async |message: Dispatch| {
                cx.send_proxied_message_to(Client, message)
            })
            .await
            .done()
    }
}

impl Conductor {
    /// Create a connection builder for a conductor.
    pub fn builder(self) -> Builder<Conductor, NullHandler, NullRun> {
        Builder::new(self)
    }
}

impl HasPeer<Client> for Conductor {
    fn remote_style(&self, _peer: Client) -> RemoteStyle {
        RemoteStyle::Predecessor
    }
}

impl HasPeer<Agent> for Conductor {
    fn remote_style(&self, _peer: Agent) -> RemoteStyle {
        RemoteStyle::Successor
    }
}

/// Dynamic handler that proxies session messages from Agent to Client.
///
/// This is used internally to handle session message routing after a
/// `session.new` request has been forwarded.
pub(crate) struct ProxySessionMessages {
    session_id: SessionId,
}

impl ProxySessionMessages {
    /// Create a new proxy handler for the given session.
    pub fn new(session_id: SessionId) -> Self {
        Self { session_id }
    }
}

impl<Counterpart: Role> HandleDispatchFrom<Counterpart> for ProxySessionMessages
where
    Counterpart: HasPeer<Agent> + HasPeer<Client>,
{
    async fn handle_dispatch_from(
        &mut self,
        message: Dispatch,
        connection: ConnectionTo<Counterpart>,
    ) -> Result<Handled<Dispatch>, crate::Error> {
        MatchDispatchFrom::new(message, &connection)
            .if_message_from(Agent, async |message| {
                // If this is for our session-id, proxy it to the client.
                if let Some(session_id) = message.get_session_id()?
                    && session_id == self.session_id
                {
                    connection.send_proxied_message_to(Client, message)?;
                    return Ok(Handled::Yes);
                }

                // Otherwise, leave it alone.
                Ok(Handled::No {
                    message,
                    retry: false,
                })
            })
            .await
            .done()
    }

    fn describe_chain(&self) -> impl std::fmt::Debug {
        format!("ProxySessionMessages({})", self.session_id)
    }
}
