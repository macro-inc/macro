//! Which sandbox provider a deployment runs on.
//!
//! [`ContainerManager`] is a type parameter, so the choice between providers is
//! a type-level one, and a composition root cannot make it from a config
//! flag without something to hold every choice. This is that something: one
//! enum that is a `ContainerManager` whichever arm it holds.
//!
//! A deployed harness has no sandbox provider today, so it holds
//! [`HarnessContainers::Unavailable`]: sandboxed sessions are declined before
//! they are created, with a pointer at the runtimes the owner can connect
//! instead.

use agent_session::domain::model::{AgentSessionId, SandboxSize};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{AgentKind, SessionBlocker, SpawnContainer};
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::{SandboxResizeEffect, create_only_resize_effect};
use crate::outbound::local::LocalContainerManager;
use crate::outbound::sidecar::SidecarTransport;

#[cfg(test)]
mod test;

/// The provider a deployment hands sandboxes out through.
#[derive(Clone)]
pub enum HarnessContainers {
    /// Containers on the local Docker daemon: what a developer runs on.
    Local(LocalContainerManager),
    /// No sandbox provider: what a deployed harness runs on.
    Unavailable,
}

impl HarnessContainers {
    /// Stop everything the provider still owns, returning the number that
    /// refused to stop.
    pub async fn shutdown_all(&self) -> usize {
        match self {
            Self::Local(manager) => manager.shutdown_all().await,
            Self::Unavailable => 0,
        }
    }
}

fn no_provider() -> HarnessError {
    HarnessError::Container("this deployment has no sandbox provider".to_owned())
}

impl ContainerManager for HarnessContainers {
    type Transport = SidecarTransport;

    async fn preflight(
        &self,
        kind: AgentKind,
        owner: &MacroUserIdStr<'_>,
    ) -> Result<Option<SessionBlocker>> {
        match self {
            Self::Local(manager) => manager.preflight(kind, owner).await,
            Self::Unavailable => Ok(Some(SessionBlocker::SandboxUnavailable)),
        }
    }

    async fn spawn(
        &self,
        command: SpawnContainer,
    ) -> Result<agent_session::domain::connection::RuntimeAttachment<Self::Transport>> {
        match self {
            Self::Local(manager) => manager.spawn(command).await,
            Self::Unavailable => Err(no_provider()),
        }
    }

    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        match self {
            Self::Local(manager) => manager.resize_effect(from, to),
            Self::Unavailable => create_only_resize_effect(from, to),
        }
    }

    async fn resize(&self, session: AgentSessionId, size: SandboxSize) -> Result<()> {
        match self {
            Self::Local(manager) => manager.resize(session, size).await,
            Self::Unavailable => Err(no_provider()),
        }
    }

    async fn resume(
        &self,
        session: AgentSessionId,
    ) -> Result<agent_session::domain::connection::RuntimeAttachment<Self::Transport>> {
        match self {
            Self::Local(manager) => manager.resume(session).await,
            Self::Unavailable => Err(no_provider()),
        }
    }

    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        match self {
            Self::Local(manager) => manager.session_token(session).await,
            Self::Unavailable => Ok(None),
        }
    }

    /// Nothing is held for a session without a provider, and refusing would
    /// leave sessions created under an earlier provider undeletable.
    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        match self {
            Self::Local(manager) => manager.teardown(session).await,
            Self::Unavailable => Ok(()),
        }
    }
}
