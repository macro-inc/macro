//! Routing between coexisting container providers.
//!
//! The sandbox provider (Daytona today) and the Cursor provider are not a
//! deployment choice between which the composition root picks one — they run
//! side by side, and which one serves a session is a per-session fact: the
//! session's bot. This manager is that fact turned into dispatch, so the
//! domain keeps talking to a single [`ContainerManager`].
//!
//! `spawn` routes on the bot the command names. `resume` and `teardown` get
//! only a session id, so they read the session's bot from the repo — the same
//! key, recovered from the same durable row that spawn wrote it to.

use agent_runtime_protocol::domain::ports::{
    Transport, TransportError, TransportReceiver, TransportSender,
};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentSessionRepo;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{AgentKind, SpawnContainer};
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::SandboxResizeEffect;
use agent_session::domain::model::SandboxSize;

#[cfg(test)]
mod test;

/// Dispatches each session to the provider its bot is served by.
#[derive(Clone)]
pub struct RoutedContainerManager<Sandbox, Cursor, Codex, Claude, Sessions> {
    sandbox: Sandbox,
    cursor: Cursor,
    codex: Codex,
    claude: Claude,
    sessions: Sessions,
}

impl<Sandbox, Cursor, Codex, Claude, Sessions>
    RoutedContainerManager<Sandbox, Cursor, Codex, Claude, Sessions>
{
    /// Wire the router over its providers.
    pub fn new(
        sandbox: Sandbox,
        cursor: Cursor,
        codex: Codex,
        claude: Claude,
        sessions: Sessions,
    ) -> Self {
        Self {
            sandbox,
            cursor,
            codex,
            claude,
            sessions,
        }
    }
}

impl<Sandbox, Cursor, Codex, Claude, Sessions> ContainerManager
    for RoutedContainerManager<Sandbox, Cursor, Codex, Claude, Sessions>
where
    Sandbox: ContainerManager,
    Cursor: ContainerManager,
    Codex: ContainerManager,
    Claude: ContainerManager,
    Sessions: AgentSessionRepo + Clone,
{
    type Transport =
        RoutedTransport<Sandbox::Transport, Cursor::Transport, Codex::Transport, Claude::Transport>;

    async fn spawn(
        &self,
        command: SpawnContainer,
    ) -> Result<agent_session::domain::connection::RuntimeAttachment<Self::Transport>> {
        match command.kind {
            AgentKind::CodexCloud => Ok(self
                .codex
                .spawn(command)
                .await?
                .map_transport(RoutedTransport::Codex)),
            AgentKind::ClaudeCloud => Ok(self
                .claude
                .spawn(command)
                .await?
                .map_transport(RoutedTransport::Claude)),
            AgentKind::Cursor => Ok(self
                .cursor
                .spawn(command)
                .await?
                .map_transport(RoutedTransport::Cursor)),
            AgentKind::SandboxedCoder | AgentKind::InMemory => Ok(self
                .sandbox
                .spawn(command)
                .await?
                .map_transport(RoutedTransport::Sandbox)),
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    async fn resume(
        &self,
        session: AgentSessionId,
    ) -> Result<agent_session::domain::connection::RuntimeAttachment<Self::Transport>> {
        let row = self.sessions.get(session).await?;
        match AgentKind::for_session(row.bot_id, &row.harness) {
            AgentKind::CodexCloud => Ok(self
                .codex
                .resume(session)
                .await?
                .map_transport(RoutedTransport::Codex)),
            AgentKind::ClaudeCloud => Ok(self
                .claude
                .resume(session)
                .await?
                .map_transport(RoutedTransport::Claude)),
            AgentKind::Cursor => Ok(self
                .cursor
                .resume(session)
                .await?
                .map_transport(RoutedTransport::Cursor)),
            AgentKind::SandboxedCoder | AgentKind::InMemory => Ok(self
                .sandbox
                .resume(session)
                .await?
                .map_transport(RoutedTransport::Sandbox)),
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        let row = self.sessions.get(session).await?;
        match AgentKind::for_session(row.bot_id, &row.harness) {
            AgentKind::CodexCloud => self.codex.session_token(session).await,
            AgentKind::ClaudeCloud => self.claude.session_token(session).await,
            AgentKind::Cursor => self.cursor.session_token(session).await,
            AgentKind::SandboxedCoder | AgentKind::InMemory => {
                self.sandbox.session_token(session).await
            }
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        let row = self.sessions.get(session).await?;
        match AgentKind::for_session(row.bot_id, &row.harness) {
            AgentKind::CodexCloud => self.codex.teardown(session).await,
            AgentKind::ClaudeCloud => self.claude.teardown(session).await,
            AgentKind::Cursor => self.cursor.teardown(session).await,
            AgentKind::SandboxedCoder | AgentKind::InMemory => self.sandbox.teardown(session).await,
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    // Sized sandboxes are a sandboxed-coder concept: the effect table is the
    // sandbox manager's, and a resize routed to a Cursor session is refused
    // rather than pretended at — its compute is Cursor's, not ours.
    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        self.sandbox.resize_effect(from, to)
    }

    async fn resize(&self, session: AgentSessionId, size: SandboxSize) -> Result<()> {
        let row = self.sessions.get(session).await?;
        match AgentKind::for_session(row.bot_id, &row.harness) {
            AgentKind::SandboxedCoder => self.sandbox.resize(session, size).await,
            AgentKind::CodexCloud => Err(HarnessError::Container(
                "a codex session has no sandbox to resize".to_owned(),
            )),
            AgentKind::ClaudeCloud => self.claude.resize(session, size).await,
            AgentKind::Cursor => Err(HarnessError::Container(
                "a cursor session has no sandbox to resize".to_owned(),
            )),
            AgentKind::InMemory => Err(HarnessError::Container(
                "an in-memory session has no sandbox to resize".to_owned(),
            )),
            AgentKind::External => Err(external_is_unroutable()),
        }
    }
}

/// The trigger gate never routes external bots here — their operators host
/// their runtimes — so an external kind reaching a provider decision means a
/// corrupt session row or a broken gate, and refusing loudly beats picking a
/// provider that cannot serve it.
fn external_is_unroutable() -> HarnessError {
    HarnessError::Container(
        "this session requires a provider outside the sandbox/Cursor router".to_owned(),
    )
}

/// A transport that is one provider's or the other's, decided per session.
pub enum RoutedTransport<Sandbox, Cursor, Codex, Claude> {
    /// A sandbox-provider transport.
    Sandbox(Sandbox),
    /// A Cursor-provider transport.
    Cursor(Cursor),
    /// A Codex cloud provider transport half.
    Codex(Codex),
    /// A Claude cloud provider transport half.
    Claude(Claude),
}

/// The sending half of a [`RoutedTransport`].
pub enum RoutedSender<Sandbox, Cursor, Codex, Claude> {
    /// A sandbox-provider sender.
    Sandbox(Sandbox),
    /// A Cursor-provider sender.
    Cursor(Cursor),
    /// A Codex cloud provider transport half.
    Codex(Codex),
    /// A Claude cloud provider transport half.
    Claude(Claude),
}

/// The receiving half of a [`RoutedTransport`].
pub enum RoutedReceiver<Sandbox, Cursor, Codex, Claude> {
    /// A sandbox-provider receiver.
    Sandbox(Sandbox),
    /// A Cursor-provider receiver.
    Cursor(Cursor),
    /// A Codex cloud provider transport half.
    Codex(Codex),
    /// A Claude cloud provider transport half.
    Claude(Claude),
}

impl<Sandbox, Cursor, Codex, Claude> Transport<ToRuntimeMessage, ToServerMessage>
    for RoutedTransport<Sandbox, Cursor, Codex, Claude>
where
    Sandbox: Transport<ToRuntimeMessage, ToServerMessage>,
    Cursor: Transport<ToRuntimeMessage, ToServerMessage>,
    Codex: Transport<ToRuntimeMessage, ToServerMessage>,
    Claude: Transport<ToRuntimeMessage, ToServerMessage>,
{
    type Sender = RoutedSender<Sandbox::Sender, Cursor::Sender, Codex::Sender, Claude::Sender>;
    type Receiver =
        RoutedReceiver<Sandbox::Receiver, Cursor::Receiver, Codex::Receiver, Claude::Receiver>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        match self {
            Self::Sandbox(transport) => {
                let (sender, receiver) = transport.split();
                (
                    RoutedSender::Sandbox(sender),
                    RoutedReceiver::Sandbox(receiver),
                )
            }
            Self::Codex(transport) => {
                let (sender, receiver) = transport.split();
                (RoutedSender::Codex(sender), RoutedReceiver::Codex(receiver))
            }
            Self::Claude(transport) => {
                let (sender, receiver) = transport.split();
                (
                    RoutedSender::Claude(sender),
                    RoutedReceiver::Claude(receiver),
                )
            }
            Self::Cursor(transport) => {
                let (sender, receiver) = transport.split();
                (
                    RoutedSender::Cursor(sender),
                    RoutedReceiver::Cursor(receiver),
                )
            }
        }
    }
}

impl<Sandbox, Cursor, Codex, Claude> TransportSender<ToRuntimeMessage>
    for RoutedSender<Sandbox, Cursor, Codex, Claude>
where
    Sandbox: TransportSender<ToRuntimeMessage>,
    Cursor: TransportSender<ToRuntimeMessage>,
    Codex: TransportSender<ToRuntimeMessage>,
    Claude: TransportSender<ToRuntimeMessage>,
{
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        match self {
            Self::Sandbox(sender) => sender.send(message).await,
            Self::Cursor(sender) => sender.send(message).await,
            Self::Codex(sender) => sender.send(message).await,
            Self::Claude(sender) => sender.send(message).await,
        }
    }
}

impl<Sandbox, Cursor, Codex, Claude> TransportReceiver<ToServerMessage>
    for RoutedReceiver<Sandbox, Cursor, Codex, Claude>
where
    Sandbox: TransportReceiver<ToServerMessage>,
    Cursor: TransportReceiver<ToServerMessage>,
    Codex: TransportReceiver<ToServerMessage>,
    Claude: TransportReceiver<ToServerMessage>,
{
    async fn recv(&mut self) -> std::result::Result<Option<ToServerMessage>, TransportError> {
        match self {
            Self::Sandbox(receiver) => receiver.recv().await,
            Self::Cursor(receiver) => receiver.recv().await,
            Self::Codex(receiver) => receiver.recv().await,
            Self::Claude(receiver) => receiver.recv().await,
        }
    }
}
