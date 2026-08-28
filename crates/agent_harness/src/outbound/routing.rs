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
pub struct RoutedContainerManager<Sandbox, Cursor, Sessions> {
    sandbox: Sandbox,
    cursor: Cursor,
    sessions: Sessions,
}

impl<Sandbox, Cursor, Sessions> RoutedContainerManager<Sandbox, Cursor, Sessions> {
    /// Wire the router over its providers.
    pub fn new(sandbox: Sandbox, cursor: Cursor, sessions: Sessions) -> Self {
        Self {
            sandbox,
            cursor,
            sessions,
        }
    }
}

impl<Sandbox, Cursor, Sessions> ContainerManager
    for RoutedContainerManager<Sandbox, Cursor, Sessions>
where
    Sandbox: ContainerManager,
    Cursor: ContainerManager,
    Sessions: AgentSessionRepo + Clone,
{
    type Transport = RoutedTransport<Sandbox::Transport, Cursor::Transport>;

    async fn spawn(&self, command: SpawnContainer) -> Result<Self::Transport> {
        match command.kind {
            AgentKind::Cursor => Ok(RoutedTransport::Cursor(self.cursor.spawn(command).await?)),
            AgentKind::SandboxedCoder | AgentKind::InMemory => {
                Ok(RoutedTransport::Sandbox(self.sandbox.spawn(command).await?))
            }
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    async fn resume(&self, session: AgentSessionId) -> Result<Self::Transport> {
        match AgentKind::of(self.sessions.get(session).await?.bot_id) {
            AgentKind::Cursor => Ok(RoutedTransport::Cursor(self.cursor.resume(session).await?)),
            AgentKind::SandboxedCoder | AgentKind::InMemory => Ok(RoutedTransport::Sandbox(
                self.sandbox.resume(session).await?,
            )),
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        match AgentKind::of(self.sessions.get(session).await?.bot_id) {
            AgentKind::Cursor => self.cursor.session_token(session).await,
            AgentKind::SandboxedCoder | AgentKind::InMemory => {
                self.sandbox.session_token(session).await
            }
            AgentKind::External => Err(external_is_unroutable()),
        }
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        match AgentKind::of(self.sessions.get(session).await?.bot_id) {
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
        match AgentKind::of(self.sessions.get(session).await?.bot_id) {
            AgentKind::SandboxedCoder => self.sandbox.resize(session, size).await,
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
    HarnessError::Container("an external bot's session has no provider to route to".to_owned())
}

/// A transport that is one provider's or the other's, decided per session.
pub enum RoutedTransport<Sandbox, Cursor> {
    /// A sandbox-provider transport.
    Sandbox(Sandbox),
    /// A Cursor-provider transport.
    Cursor(Cursor),
}

/// The sending half of a [`RoutedTransport`].
pub enum RoutedSender<Sandbox, Cursor> {
    /// A sandbox-provider sender.
    Sandbox(Sandbox),
    /// A Cursor-provider sender.
    Cursor(Cursor),
}

/// The receiving half of a [`RoutedTransport`].
pub enum RoutedReceiver<Sandbox, Cursor> {
    /// A sandbox-provider receiver.
    Sandbox(Sandbox),
    /// A Cursor-provider receiver.
    Cursor(Cursor),
}

impl<Sandbox, Cursor> Transport<ToRuntimeMessage, ToServerMessage>
    for RoutedTransport<Sandbox, Cursor>
where
    Sandbox: Transport<ToRuntimeMessage, ToServerMessage>,
    Cursor: Transport<ToRuntimeMessage, ToServerMessage>,
{
    type Sender = RoutedSender<Sandbox::Sender, Cursor::Sender>;
    type Receiver = RoutedReceiver<Sandbox::Receiver, Cursor::Receiver>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        match self {
            Self::Sandbox(transport) => {
                let (sender, receiver) = transport.split();
                (
                    RoutedSender::Sandbox(sender),
                    RoutedReceiver::Sandbox(receiver),
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

impl<Sandbox, Cursor> TransportSender<ToRuntimeMessage> for RoutedSender<Sandbox, Cursor>
where
    Sandbox: TransportSender<ToRuntimeMessage>,
    Cursor: TransportSender<ToRuntimeMessage>,
{
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        match self {
            Self::Sandbox(sender) => sender.send(message).await,
            Self::Cursor(sender) => sender.send(message).await,
        }
    }
}

impl<Sandbox, Cursor> TransportReceiver<ToServerMessage> for RoutedReceiver<Sandbox, Cursor>
where
    Sandbox: TransportReceiver<ToServerMessage>,
    Cursor: TransportReceiver<ToServerMessage>,
{
    async fn recv(&mut self) -> std::result::Result<Option<ToServerMessage>, TransportError> {
        match self {
            Self::Sandbox(receiver) => receiver.recv().await,
            Self::Cursor(receiver) => receiver.recv().await,
        }
    }
}
