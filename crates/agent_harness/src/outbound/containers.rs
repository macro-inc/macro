//! Which sandbox provider a deployment runs on.
//!
//! [`ContainerManager`] is a type parameter, so the choice between providers is
//! a type-level one, and a composition root cannot make it from a config
//! flag without something to hold both. This is that something: one enum
//! that is a `ContainerManager` whichever arm it holds.
//!
//! Both arms happen to split into the same halves — every provider dials a
//! sidecar over a websocket — so the transport needs no enum of its own, and
//! only the manager does.

use agent_runtime_protocol::domain::ports::Transport;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::{AgentSessionId, SandboxSize};

use crate::domain::error::Result;
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::SandboxResizeEffect;
use crate::outbound::daytona::{DaytonaContainer, DaytonaContainerManager};
use crate::outbound::local::LocalContainerManager;
use crate::outbound::sidecar::{SidecarSender, SidecarTransport};

/// The provider a deployment hands sandboxes out through.
#[derive(Clone)]
pub enum HarnessContainers {
    /// Daytona sandboxes: what a deployed harness runs on.
    Daytona(DaytonaContainerManager),
    /// Containers on the local Docker daemon: what a developer runs on.
    Local(LocalContainerManager),
}

/// A sandbox from either provider.
pub enum HarnessContainer {
    /// A Daytona sandbox.
    Daytona(DaytonaContainer),
    /// A local Docker container.
    Local(SidecarTransport),
}

impl HarnessContainers {
    /// Stop everything the provider still owns, returning the number that
    /// refused to stop.
    pub async fn shutdown_all(&self) -> usize {
        match self {
            Self::Daytona(manager) => manager.shutdown_all().await,
            Self::Local(manager) => manager.shutdown_all().await,
        }
    }
}

impl ContainerManager for HarnessContainers {
    type Transport = HarnessContainer;

    async fn spawn(&self, command: SpawnContainer) -> Result<Self::Transport> {
        match self {
            Self::Daytona(manager) => manager.spawn(command).await.map(HarnessContainer::Daytona),
            Self::Local(manager) => manager.spawn(command).await.map(HarnessContainer::Local),
        }
    }

    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        match self {
            Self::Daytona(manager) => manager.resize_effect(from, to),
            Self::Local(manager) => manager.resize_effect(from, to),
        }
    }

    async fn resize(&self, session: AgentSessionId, size: SandboxSize) -> Result<()> {
        match self {
            Self::Daytona(manager) => manager.resize(session, size).await,
            Self::Local(manager) => manager.resize(session, size).await,
        }
    }

    async fn resume(&self, session: AgentSessionId) -> Result<Self::Transport> {
        match self {
            Self::Daytona(manager) => manager.resume(session).await.map(HarnessContainer::Daytona),
            Self::Local(manager) => manager.resume(session).await.map(HarnessContainer::Local),
        }
    }

    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        match self {
            Self::Daytona(manager) => manager.session_token(session).await,
            Self::Local(manager) => manager.session_token(session).await,
        }
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        match self {
            Self::Daytona(manager) => manager.teardown(session).await,
            Self::Local(manager) => manager.teardown(session).await,
        }
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for HarnessContainer {
    type Sender = SidecarSender;
    type Receiver = tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        match self {
            Self::Daytona(container) => container.split(),
            Self::Local(transport) => transport.split(),
        }
    }
}
