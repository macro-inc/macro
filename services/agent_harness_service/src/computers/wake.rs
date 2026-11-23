//! Waking a hibernated computer for a prompt: [`WakingConnections`] wraps the
//! harness's runtime connections, and when a session finds no live runtime
//! for a bot whose harness runs on a computer, asks the operator to wake it
//! and waits up to [`DISPATCH_WAKE_TIMEOUT`] for its macrod to dial. Past that
//! (no room on the host yet, or macrod dialed another replica) the prompt
//! stays queued, and macrod's dial dispatches it like any prompt that waited
//! for a runtime.

use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::v1::SessionId;
use agent_harness::domain::model::{ListedSessions, RuntimeAccessFacts};
use agent_harness::domain::ports::RuntimeConnections;
use agent_session::domain::connection::{RuntimeAttachment, RuntimeConnectionId};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use harness_id::HarnessId;
use hosted_runtimes::domain::operator::DispatchWake;
use hosted_runtimes::domain::service::ComputerError;
use macro_user_id::user_id::MacroUserIdStr;
use tracing::Instrument;

use super::Operator;

/// How long a prompt waits for a woken computer's macrod: a restore takes
/// under a second and macrod dials within a few more.
pub const DISPATCH_WAKE_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(test)]
mod test;

/// Wakes the computer behind a harness for a prompt: the computer operator.
pub trait DispatchWaker: Send + Sync + 'static {
    /// [`Operator::wake_for_dispatch`].
    fn wake_for_dispatch(
        &self,
        harness: HarnessId,
        timeout: Duration,
    ) -> impl Future<Output = Result<DispatchWake, ComputerError>> + Send;
}

impl DispatchWaker for Operator {
    fn wake_for_dispatch(
        &self,
        harness: HarnessId,
        timeout: Duration,
    ) -> impl Future<Output = Result<DispatchWake, ComputerError>> + Send {
        Operator::wake_for_dispatch(self, harness, timeout)
    }
}

/// [`RuntimeConnections`] that wakes a bot's hibernated computer when a
/// session finds no runtime for it.
pub struct WakingConnections<Inner, Waker = Operator> {
    inner: Inner,
    waker: Option<Arc<Waker>>,
}

impl<Inner, Waker> WakingConnections<Inner, Waker> {
    /// Wrap `inner`; without a waker (no computer fleet) nothing is woken.
    pub fn new(inner: Inner, waker: Option<Arc<Waker>>) -> Self {
        Self { inner, waker }
    }
}

impl<Inner: RuntimeConnections, Waker: DispatchWaker> WakingConnections<Inner, Waker> {
    /// Wake the computer behind `bot`'s harness and wait for its macrod;
    /// whether it connected.
    async fn wake(&self, waker: &Waker, bot: BotId) -> bool {
        let harness = match self.inner.bound_harness(bot).await {
            Ok(Some(harness)) => harness,
            Ok(None) => return false,
            Err(error) => {
                tracing::warn!(error = ?error, "could not resolve a bot's harness to wake its computer");
                return false;
            }
        };
        match waker
            .wake_for_dispatch(harness, DISPATCH_WAKE_TIMEOUT)
            .await
        {
            Ok(outcome) => outcome == DispatchWake::Connected,
            Err(error) => {
                tracing::warn!(%harness, error = ?error, "could not wake a computer for a prompt");
                false
            }
        }
    }
}

impl<Inner: RuntimeConnections, Waker: DispatchWaker> RuntimeConnections
    for WakingConnections<Inner, Waker>
{
    type Connector = Inner::Connector;

    async fn bind(
        &self,
        bot: BotId,
        session: AgentSessionId,
    ) -> Option<RuntimeAttachment<Self::Connector>> {
        if let Some(attachment) = self.inner.bind(bot, session).await {
            return Some(attachment);
        }
        let waker = self.waker.as_ref()?;
        let span = tracing::info_span!("computer.wake_for_prompt", %session, connected = tracing::field::Empty);
        async {
            let connected = self.wake(waker, bot).await;
            tracing::Span::current().record("connected", connected);
            if connected {
                self.inner.bind(bot, session).await
            } else {
                None
            }
        }
        .instrument(span)
        .await
    }

    fn bound_harness(
        &self,
        bot: BotId,
    ) -> impl Future<Output = anyhow::Result<Option<HarnessId>>> + Send {
        self.inner.bound_harness(bot)
    }

    fn access_facts(
        &self,
        bot: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> impl Future<Output = anyhow::Result<Option<RuntimeAccessFacts>>> + Send {
        self.inner.access_facts(bot, actor)
    }

    fn is_connected(&self, harness: HarnessId) -> bool {
        self.inner.is_connected(harness)
    }

    fn connection_of(&self, harness: HarnessId) -> Option<RuntimeConnectionId> {
        self.inner.connection_of(harness)
    }

    fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> impl Future<Output = anyhow::Result<ListedSessions>> + Send {
        self.inner.sessions_on_harness(harness, acp_sessions)
    }
}
