//! Turning on a runtime's permission bypass from one of its sessions'
//! permission requests.
//!
//! A registered runtime's sessions approve on their own only when the runtime
//! allows bypass and the session's permission choice is to bypass
//! ([`crate::domain::model::resolve_permission_policy`]). Stopping the asking
//! from a request therefore turns on the runtime's bypass and, where the
//! session follows its agent's live choice and that choice is to ask, the
//! agent's too. It is offered only when both changes are the caller's to make
//! and together they stop the prompts.

use std::future::Future;

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// One agent's runtime as the caller finds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeBypassFacts {
    /// The registered runtime the agent runs on.
    pub harness: HarnessId,
    /// The runtime already allows bypass.
    pub runtime_allows_bypass: bool,
    /// The caller may change the runtime's settings.
    pub caller_manages_runtime: bool,
    /// The agent's own choice is to bypass.
    pub agent_auto_accepts: bool,
    /// The caller may change the agent's settings.
    pub caller_manages_agent: bool,
}

/// Whose permission choice a session follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPermissionChoice {
    /// The agent's current choice, read again before every turn.
    Agent,
    /// The choice adopted when the conversation's session opened, kept since.
    Pinned {
        /// The adopted choice is to bypass.
        auto_accepts: bool,
    },
}

/// What stopping the asking changes for one session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeBypassOffer {
    /// The runtime whose bypass is turned on.
    pub harness: HarnessId,
    /// The agent asks by its own choice too, so it is set to bypass as well.
    pub enables_agent_auto_accept: bool,
}

/// The changes that stop `choice`'s session asking, when the caller may make
/// all of them. `None` when the runtime already allows bypass (the agent's
/// own setting is the agent's business, not this runtime's), when the session
/// keeps an adopted choice to ask, or when a needed change is not the
/// caller's.
#[must_use]
pub fn offer(
    choice: SessionPermissionChoice,
    facts: RuntimeBypassFacts,
) -> Option<RuntimeBypassOffer> {
    if facts.runtime_allows_bypass || !facts.caller_manages_runtime {
        return None;
    }

    let enables_agent_auto_accept = match choice {
        SessionPermissionChoice::Pinned { auto_accepts: true } => false,
        SessionPermissionChoice::Pinned {
            auto_accepts: false,
        } => return None,
        SessionPermissionChoice::Agent if facts.agent_auto_accepts => false,
        SessionPermissionChoice::Agent if facts.caller_manages_agent => true,
        SessionPermissionChoice::Agent => return None,
    };

    Some(RuntimeBypassOffer {
        harness: facts.harness,
        enables_agent_auto_accept,
    })
}

/// What happened to the agent's own choice when the asking was stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentChoiceChange {
    /// The agent's choice already bypassed, or the session does not follow it.
    NotNeeded,
    /// The agent is now set to bypass.
    SetToBypass,
    /// The runtime allows bypass now, but setting the agent failed, so the
    /// agent still asks.
    StillAsks,
}

/// What stopping the asking changed. The runtime's bypass is on in every
/// case; a failure to turn it on is an error, since nothing changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoppedAsking {
    /// The runtime whose bypass is now on.
    pub harness: HarnessId,
    /// What happened to the agent's own choice.
    pub agent: AgentChoiceChange,
}

/// Why the asking could not be stopped.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeBypassError {
    /// Nothing the caller may change would stop this session asking, or it
    /// already does not ask.
    #[error("this session's runtime cannot stop asking for permission")]
    Unavailable,
    /// A change was refused for the caller.
    #[error("not allowed to change this runtime or agent")]
    Forbidden,
    /// The session could not be read.
    #[error(transparent)]
    Session(#[from] AgentSessionError),
    /// The runtime or agent settings could not be read or written.
    #[error(transparent)]
    Settings(#[from] anyhow::Error),
}

/// Reads and changes the runtime and agent settings bypass depends on, each
/// change authorized by the domain that owns the setting.
#[async_trait::async_trait]
pub trait RuntimeBypassSettings: Send + Sync + 'static {
    /// The runtime `bot` runs on as `caller` finds it; `None` when `bot` is
    /// not an agent on a registered runtime.
    async fn facts(
        &self,
        caller: &MacroUserIdStr<'static>,
        bot: BotId,
    ) -> anyhow::Result<Option<RuntimeBypassFacts>>;

    /// Turn on `harness`'s bypass as `caller`.
    async fn allow_runtime_bypass(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<(), RuntimeBypassError>;

    /// Set `bot`'s own choice to bypass as `caller`.
    async fn auto_accept_permissions(
        &self,
        caller: &MacroUserIdStr<'static>,
        bot: BotId,
    ) -> Result<(), RuntimeBypassError>;
}

/// No registered runtimes: nothing is ever offered.
pub struct NoRuntimeBypass;

#[async_trait::async_trait]
impl RuntimeBypassSettings for NoRuntimeBypass {
    async fn facts(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _bot: BotId,
    ) -> anyhow::Result<Option<RuntimeBypassFacts>> {
        Ok(None)
    }

    async fn allow_runtime_bypass(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _harness: HarnessId,
    ) -> Result<(), RuntimeBypassError> {
        Err(RuntimeBypassError::Unavailable)
    }

    async fn auto_accept_permissions(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _bot: BotId,
    ) -> Result<(), RuntimeBypassError> {
        Err(RuntimeBypassError::Unavailable)
    }
}

/// Stopping a session's permission requests from one of them.
pub trait RuntimeBypassService: Send + Sync + 'static {
    /// What stopping the asking would change for `session`, if the caller
    /// may make it.
    fn runtime_bypass_offer(
        &self,
        caller: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<RuntimeBypassOffer>, RuntimeBypassError>> + Send;

    /// Make the changes [`Self::runtime_bypass_offer`] names: the runtime's
    /// bypass first, since an agent may only choose bypass on a runtime that
    /// allows it, then the agent's. An error means nothing changed; once the
    /// runtime's bypass is on, a failed agent change is reported as
    /// [`AgentChoiceChange::StillAsks`]. The session takes the new policy when
    /// a person next answers one of its permission requests, or at its next
    /// turn.
    fn stop_asking_on_runtime(
        &self,
        caller: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<StoppedAsking, RuntimeBypassError>> + Send;
}
