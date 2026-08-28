//! Routes container provisioning between the runtimes this deployment hosts.
//!
//! One deployment can manage two bots: a sandboxed bot, whose sessions come
//! from whichever provider [`HarnessContainers`] holds (Daytona, or local
//! Docker when a developer opts in), and the in-memory agent bot, whose
//! sessions run in-process. The session row's `bot_id` - written before any
//! container is asked for - decides which runtime a session's transport comes
//! from.

use agent_harness::domain::error::{HarnessError, Result};
use agent_harness::domain::model::{AgentKind, SpawnContainer};
use agent_harness::domain::ports::ContainerManager;
use agent_harness::domain::sandbox::SandboxResizeEffect;
use agent_harness::outbound::containers::{HarnessContainer, HarnessContainers};
use agent_harness::outbound::sidecar::SidecarSender;
use agent_inmem::outbound::manager::{InMemAgentManager, SessionFacts};
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::ports::{Transport, TransportError, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::{AgentSessionId, SandboxSize};
use agent_session::domain::service::AgentSessionService;
use bot_id::BotId;

#[cfg(test)]
mod test;

/// A session transport from whichever runtime the session's bot uses.
pub enum RoutedTransport {
    /// A sandboxed session's sidecar-backed transport.
    Sandbox(HarnessContainer),
    /// An in-process session's channel.
    InMem(ServerChannel),
}

/// The sending half of a [`RoutedTransport`].
pub enum RoutedSender {
    /// Sends into the sandbox sidecar socket.
    Sandbox(SidecarSender),
    /// Sends into the in-process agent.
    InMem(tokio::sync::mpsc::UnboundedSender<ToRuntimeMessage>),
}

impl Transport<ToRuntimeMessage, ToServerMessage> for RoutedTransport {
    type Sender = RoutedSender;
    type Receiver = tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        match self {
            Self::Sandbox(transport) => {
                let (sender, receiver) = transport.split();
                (RoutedSender::Sandbox(sender), receiver)
            }
            Self::InMem(channel) => {
                let (sender, receiver) = channel.split();
                (RoutedSender::InMem(sender), receiver)
            }
        }
    }
}

impl TransportSender<ToRuntimeMessage> for RoutedSender {
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        match self {
            Self::Sandbox(sender) => sender.send(message).await,
            Self::InMem(sender) => TransportSender::send(sender, message).await,
        }
    }
}

/// The in-memory runtime and the bot whose sessions it serves.
pub struct InMemRuntime {
    /// Sessions of this bot run in-process.
    pub bot: BotId,
    /// Their provisioner.
    pub manager: InMemAgentManager,
}

/// The deployment's [`ContainerManager`]: the sandbox provider for the
/// sandboxed bot, in-process for the in-memory bot when one is configured.
pub struct RoutedContainers<Sessions> {
    sandbox: HarnessContainers,
    inmem: Option<InMemRuntime>,
    sessions: Sessions,
}

#[derive(Debug)]
enum Route {
    Sandbox,
    InMem(SessionFacts),
}

impl<Sessions> RoutedContainers<Sessions>
where
    Sessions: AgentSessionService,
{
    /// Route by bot: `sessions` is where a session's bot is looked up.
    pub fn new(
        sandbox: HarnessContainers,
        inmem: Option<InMemRuntime>,
        sessions: Sessions,
    ) -> Self {
        Self {
            sandbox,
            inmem,
            sessions,
        }
    }

    /// Which runtime serves `session`. The row exists before any container
    /// operation - `open` creates it first - so the lookup is authoritative.
    ///
    /// Deliberately has no "when in doubt, use the sandbox" branch. The
    /// in-process bot must never be handed a sandbox: it has no repository to
    /// clone and no reason to cost a Daytona container, so a deployment that
    /// cannot serve it refuses the session instead of silently provisioning
    /// the wrong runtime for it.
    async fn route(&self, session: AgentSessionId) -> Result<Route> {
        let row = self
            .sessions
            .get_session(session)
            .await
            .map_err(HarnessError::Session)?;
        if let Some(inmem) = &self.inmem
            && row.bot_id == inmem.bot
        {
            return Ok(Route::InMem(SessionFacts {
                id: session,
                owner: row.owner_id,
                model: row.model,
                instructions: row.instructions,
                acp_session_id: row.acp_session_id,
            }));
        }
        if AgentKind::of(row.bot_id) == AgentKind::InMemory {
            return Err(HarnessError::Container(format!(
                "session {session} belongs to the in-process bot, which this deployment does not serve"
            )));
        }
        Ok(Route::Sandbox)
    }

    fn inmem(&self) -> &InMemRuntime {
        self.inmem
            .as_ref()
            .expect("an in-memory route exists only when the runtime is configured")
    }
}

impl<Sessions> ContainerManager for RoutedContainers<Sessions>
where
    Sessions: AgentSessionService,
{
    type Transport = RoutedTransport;

    async fn spawn(&self, command: SpawnContainer) -> Result<Self::Transport> {
        match self.route(command.session_id).await? {
            Route::InMem(facts) => Ok(RoutedTransport::InMem(
                self.inmem().manager.attach(facts).await,
            )),
            Route::Sandbox => self
                .sandbox
                .spawn(command)
                .await
                .map(RoutedTransport::Sandbox),
        }
    }

    /// Delegated to the sandbox provider: the signature carries no session,
    /// so there is no bot to route on. An in-process session has no sandbox,
    /// so the worst this costs is a needless close-and-resume before a
    /// [`Self::resize`] that does nothing.
    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        self.sandbox.resize_effect(from, to)
    }

    /// A no-op for in-process sessions - there is no container whose compute
    /// could change - and the provider's business for everyone else.
    async fn resize(&self, session: AgentSessionId, size: SandboxSize) -> Result<()> {
        match self.route(session).await? {
            Route::InMem(_) => Ok(()),
            Route::Sandbox => self.sandbox.resize(session, size).await,
        }
    }

    async fn resume(&self, session: AgentSessionId) -> Result<Self::Transport> {
        match self.route(session).await? {
            Route::InMem(facts) => Ok(RoutedTransport::InMem(
                self.inmem().manager.attach(facts).await,
            )),
            Route::Sandbox => self
                .sandbox
                .resume(session)
                .await
                .map(RoutedTransport::Sandbox),
        }
    }

    /// An in-process session has no container and no egress environment, so
    /// there is no token to read back; sandboxes delegate to their provider.
    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        match self.route(session).await? {
            Route::InMem(_) => Ok(None),
            Route::Sandbox => self.sandbox.session_token(session).await,
        }
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        match self.route(session).await? {
            Route::InMem(_) => {
                self.inmem().manager.teardown(session);
                Ok(())
            }
            Route::Sandbox => self.sandbox.teardown(session).await,
        }
    }
}
