//! MCP server attachment and routing for ACP sessions.

use std::{marker::PhantomData, sync::Arc};

use futures::{StreamExt, channel::mpsc};
use uuid::Uuid;

use crate::{
    Agent, Client, ConnectTo, ConnectionTo, Dispatch, DynConnectTo, HandleDispatchFrom, Handled,
    Role,
    jsonrpc::{
        DynamicHandlerRegistration,
        run::{NullRun, RunWithConnectionTo},
    },
    mcp_server::{McpConnectionTo, McpServerConnect, active_session::McpActiveSession},
    role::{self, HasPeer},
    schema::v1::{McpServer as SchemaMcpServer, McpServerHttp, NewSessionRequest},
    util::MatchDispatchFrom,
};

/// An MCP server that can be attached to ACP connections.
///
/// `McpServer` wraps an [`McpServerConnect`](`super::McpServerConnect`) implementation and can be used either:
/// - As a message handler via [`Builder::with_handler`](`crate::Builder::with_handler`), automatically
///   attaching to new sessions
/// - Manually for more control
///
/// # Creating an MCP Server
///
/// The `agent-client-protocol-rmcp` crate provides builder APIs for MCP tools
/// backed by the `rmcp` crate.
///
/// Or implement [`McpServerConnect`](`super::McpServerConnect`) for custom server behavior:
///
/// ```rust,ignore
/// let server = McpServer::new(MyCustomServerConnect);
/// ```
pub struct McpServer<Counterpart: Role, Run = NullRun> {
    /// The host role that is serving up this MCP server
    phantom: PhantomData<Counterpart>,

    /// The ACP identifier we assigned for this mcp server; always unique
    acp_id: String,

    /// The "connect" instance
    connect: Arc<dyn McpServerConnect<Counterpart>>,

    /// The "responder" is a task that should be run alongside the message handler.
    /// Some futures direct messages back through channels to this future which actually
    /// handles responding to the client.
    ///
    /// Some connector implementations use this to run support tasks alongside
    /// the message handler.
    responder: Run,
}

impl<Counterpart: Role + std::fmt::Debug, Run: std::fmt::Debug> std::fmt::Debug
    for McpServer<Counterpart, Run>
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpServer")
            .field("phantom", &self.phantom)
            .field("acp_id", &self.acp_id)
            .field("responder", &self.responder)
            .finish_non_exhaustive()
    }
}

impl<Counterpart: Role, Run> McpServer<Counterpart, Run>
where
    Run: RunWithConnectionTo<Counterpart>,
{
    /// Create an MCP server from something that implements the [`McpServerConnect`](`super::McpServerConnect`) trait.
    ///
    /// # See also
    ///
    /// See `agent-client-protocol-rmcp` to construct MCP servers from Rust code
    /// with `rmcp`.
    pub fn new(c: impl McpServerConnect<Counterpart>, responder: Run) -> Self {
        McpServer {
            phantom: PhantomData,
            acp_id: format!("acp:{}", Uuid::new_v4()),
            connect: Arc::new(c),
            responder,
        }
    }

    /// Split this MCP server into the message handler and a future that must be run while the handler is active.
    pub(crate) fn into_handler_and_responder(self) -> (McpNewSessionHandler<Counterpart>, Run)
    where
        Counterpart: HasPeer<Agent>,
    {
        let Self {
            phantom: _,
            acp_id,
            connect,
            responder,
        } = self;
        (McpNewSessionHandler::new(acp_id, connect), responder)
    }
}

/// Message handler created from a [`McpServer`].
pub(crate) struct McpNewSessionHandler<Counterpart: Role>
where
    Counterpart: HasPeer<Agent>,
{
    acp_id: String,
    connect: Arc<dyn McpServerConnect<Counterpart>>,
    active_session: McpActiveSession<Counterpart>,
}

impl<Counterpart: Role> McpNewSessionHandler<Counterpart>
where
    Counterpart: HasPeer<Agent>,
{
    pub fn new(acp_id: String, connect: Arc<dyn McpServerConnect<Counterpart>>) -> Self {
        Self {
            active_session: McpActiveSession::new(acp_id.clone(), connect.clone()),
            acp_id,
            connect,
        }
    }

    /// Modify the new session request to include this MCP server.
    fn modify_new_session_request(&self, request: &mut NewSessionRequest) {
        request
            .mcp_servers
            .push(SchemaMcpServer::Http(McpServerHttp::new(
                self.connect.name(),
                self.acp_id.clone(),
            )));
    }
}

impl<Counterpart: Role> McpNewSessionHandler<Counterpart>
where
    Counterpart: HasPeer<Agent>,
{
    /// Attach this server to the new session, spawning off a dynamic handler that will
    /// manage requests coming from this session.
    ///
    /// # Return value
    ///
    /// Returns a [`DynamicHandlerRegistration`] for the handler that intercepts messages
    /// related to this MCP server. Once the value is dropped, the MCP server messages
    /// will no longer be received, so you need to keep this value alive as long as the session
    /// is in use. You can also invoke [`DynamicHandlerRegistration::run_indefinitely`]
    /// if you want to keep the handler running indefinitely.
    pub fn into_dynamic_handler(
        self,
        request: &mut NewSessionRequest,
        cx: &ConnectionTo<Counterpart>,
    ) -> Result<DynamicHandlerRegistration<Counterpart>, crate::Error>
    where
        Counterpart: HasPeer<Agent>,
    {
        self.modify_new_session_request(request);
        cx.add_dynamic_handler(self.active_session)
    }
}

impl<Counterpart: Role> HandleDispatchFrom<Counterpart> for McpNewSessionHandler<Counterpart>
where
    Counterpart: HasPeer<Client> + HasPeer<Agent>,
{
    async fn handle_dispatch_from(
        &mut self,
        message: Dispatch,
        cx: ConnectionTo<Counterpart>,
    ) -> Result<Handled<Dispatch>, crate::Error> {
        MatchDispatchFrom::new(message, &cx)
            .if_request_from(Client, async |mut request: NewSessionRequest, responder| {
                self.modify_new_session_request(&mut request);
                Ok(Handled::No {
                    message: (request, responder),
                    retry: false,
                })
            })
            .await
            .otherwise_delegate(&mut self.active_session)
            .await
    }

    fn describe_chain(&self) -> impl std::fmt::Debug {
        format!("McpServer({})", self.connect.name())
    }
}

impl<Run> ConnectTo<role::mcp::Client> for McpServer<role::mcp::Client, Run>
where
    Run: RunWithConnectionTo<role::mcp::Client> + 'static,
{
    async fn connect_to(
        self,
        client: impl ConnectTo<role::mcp::Server>,
    ) -> Result<(), crate::Error> {
        let Self {
            acp_id,
            connect,
            responder,
            phantom: _,
        } = self;

        let (tx, mut rx) = mpsc::unbounded();

        role::mcp::Server
            .builder()
            .with_responder(responder)
            .on_receive_dispatch(
                async |message_from_client: Dispatch, _cx| {
                    tx.unbounded_send(message_from_client)
                        .map_err(|_| crate::util::internal_error("nobody listening to mcp server"))
                },
                crate::on_receive_dispatch!(),
            )
            .with_spawned(async move |connection_to_client| {
                let spawned_server: DynConnectTo<role::mcp::Client> =
                    connect.connect(McpConnectionTo {
                        acp_id,
                        connection: connection_to_client.clone(),
                    });

                role::mcp::Client
                    .builder()
                    .on_receive_dispatch(
                        async |message_from_server: Dispatch, _| {
                            // when we receive a message from the server, fwd to the client
                            connection_to_client.send_proxied_message(message_from_server)
                        },
                        crate::on_receive_dispatch!(),
                    )
                    .connect_with(spawned_server, async |connection_to_server| {
                        while let Some(message_from_client) = rx.next().await {
                            connection_to_server.send_proxied_message(message_from_client)?;
                        }
                        Ok(())
                    })
                    .await
            })
            .connect_to(client)
            .await
    }
}
