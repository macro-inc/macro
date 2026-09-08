//! The orchestrator behind every agent session: one service over the ports
//! in [`crate::domain::ports`], split by concern.
//!
//! - [`queue`]: the per-session command queue and its worker, the one-turn-
//!   in-flight invariant, and routing a command to whichever replica holds
//!   the session's actor.
//! - [`open`]: creating sessions - from a mention, from the create menu, or
//!   for an external runtime - and provisioning their egress.
//! - [`deliver`]: composing a queued action with channel context and handing
//!   it to the running agent, announcing it in the channel first.
//! - [`lifecycle`]: everything after open - control events, sandbox size,
//!   turn boundaries, teardown.
//!
//! This file holds the service type itself and its public entry points.

#[cfg(test)]
mod test;

mod deliver;
mod lifecycle;
mod open;
mod queue;

use std::sync::Arc;

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::SessionManagement;
use agent_session::domain::model::{
    AgentMcpServers, AgentSession, AgentSessionId, AuthorKind, CreateAgentSessionParams, MessageId,
    SandboxSize,
};
use agent_session::domain::ports::{
    AcceptedControl, AgentSessionNotificationRecipient, AgentSessionQueueChanged,
    ControlDisposition, ControlEvent, QueuedControl,
};
use agent_session::domain::service::AgentSessionService;
use bot_id::BotId;
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{mpsc, oneshot};
use tracing::Instrument as _;
use tracing::instrument::WithSubscriber as _;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AgentKind, AnnounceOrigin, AnnouncePrompt, CommandOutcome, DeliverAction, HarnessCommand,
    HarnessDefaults, OpenSession, SessionAnnouncement, SpawnContainer, is_macro_staff,
};
use crate::domain::ports::{
    AgentPromptComposer, ChannelPromptContext, CommandForwarder, ContainerManager,
    RuntimeConnections, SandboxEgressProvisioner, SessionAnnouncer,
};
use crate::domain::queue::{QueueError, QueuedEntry, SessionQueues};
use crate::domain::sandbox::SandboxResizeEffect;

use self::queue::{ErasedForwarder, SessionWorkers};

struct AgentHarnessInner<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
> {
    sessions: Sessions,
    containers: Containers,
    announcer: Announcer,
    runtimes: Runtimes,
    prompt_context: PromptContext,
    prompt_composer: PromptComposer,
    egress: Egress,
    forwarder: Box<dyn ErasedForwarder>,
    defaults: HarnessDefaults,
    /// Turn-occupying actions waiting for their session's running turn to
    /// end. In-memory beside the live actors this replica manages.
    queues: SessionQueues,
    /// The sessions with a turn in flight. Marked when a turn-occupying
    /// action reaches the runtime, cleared by `TurnEnded`/`SessionStopped`.
    /// Only ever touched from the session's own command worker, which is
    /// what serializes it against dispatch.
    busy: DashMap<AgentSessionId, ()>,
}

/// Turns trigger commands into running, announced agent sessions.
pub struct AgentHarnessService<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
> {
    inner: Arc<
        AgentHarnessInner<
            Sessions,
            Containers,
            Announcer,
            Runtimes,
            PromptContext,
            PromptComposer,
            Egress,
        >,
    >,
    workers: Arc<SessionWorkers>,
}

// Manual Clone impl so the port types don't need to be Clone (both fields
// are behind Arcs). A clone is another handle on the same workers and queues,
// which is what lets the service be bound as its own session services' turn
// observer.
impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress> Clone
    for AgentHarnessService<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
    >
{
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            workers: Arc::clone(&self.workers),
        }
    }
}

impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    AgentHarnessService<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
{
    /// Build the orchestrator from its ports.
    ///
    /// One argument per port, however many ports there are: bundling some of
    /// them into a struct would only move the same list one level down.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        sessions: Sessions,
        containers: Containers,
        announcer: Announcer,
        runtimes: Runtimes,
        prompt_context: PromptContext,
        prompt_composer: PromptComposer,
        egress: Egress,
        forwarder: impl CommandForwarder,
        defaults: impl Into<HarnessDefaults>,
    ) -> Self {
        Self {
            inner: Arc::new(AgentHarnessInner {
                sessions,
                containers,
                announcer,
                runtimes,
                prompt_context,
                prompt_composer,
                egress,
                forwarder: Box::new(forwarder),
                defaults: defaults.into(),
                queues: SessionQueues::new(),
                busy: DashMap::new(),
            }),
            workers: Arc::new(DashMap::new()),
        }
    }

    /// Queue one command behind any work already running for its session.
    ///
    /// Queue admission happens synchronously so callers can spawn the returned
    /// completion future without reordering commands. It is also where the
    /// caller's span is captured: the returned future only awaits a oneshot, so
    /// the span has to travel with the command to reach the work itself.
    pub fn execute(
        &self,
        session_id: AgentSessionId,
        command: HarnessCommand,
    ) -> impl Future<Output = Result<CommandOutcome>> + Send + 'static {
        self.enqueue(session_id, command, true)
    }

    /// [`execute`](Self::execute), without resolving which replica manages
    /// the session first.
    ///
    /// The entry point for commands received *as* forwards: the sender
    /// already resolved management to this replica, and re-resolving here is
    /// what could bounce a command between two replicas whose lease views
    /// momentarily differ. Forwarding is single-hop; this is the second hop's
    /// half of that contract.
    pub fn execute_here(
        &self,
        session_id: AgentSessionId,
        command: HarnessCommand,
    ) -> impl Future<Output = Result<CommandOutcome>> + Send + 'static {
        self.enqueue(session_id, command, false)
    }

    /// Post the announcement for a prompt an external runtime delivers.
    ///
    /// The follow-up-mention half of the external split: the runtime sends
    /// the prompt through the control endpoint, and the observed trigger
    /// event lands here to post the magic chip the replies render into.
    /// Needs only the session row - a chip must post even while the runtime
    /// is disconnected, anchoring whatever reply eventually comes.
    #[tracing::instrument(err, skip(self, prompt), fields(%session_id))]
    pub async fn announce_external_prompt(
        &self,
        session_id: AgentSessionId,
        prompt: AnnouncePrompt,
    ) -> Result<()> {
        // Re-read rather than trusted: the row is what vouches that the
        // trigger's session and bot actually belong together.
        let session = self.inner.sessions.get_session(session_id).await?;
        if session.bot_id != prompt.bot_id {
            tracing::warn!(
                %session_id,
                event_bot = %prompt.bot_id,
                session_bot = %session.bot_id,
                "dropping an announce whose bot does not own the session"
            );
            return Ok(());
        }

        self.inner
            .announcer
            .announce(SessionAnnouncement {
                session_id,
                bot_id: session.bot_id,
                origin_channel_id: prompt.origin.channel_id,
                origin_thread_id: prompt.origin.thread_id,
                origin_message_id: prompt.origin.message_id,
                prompted_message_id: self
                    .inner
                    .sessions
                    .next_prompt_message_id(session_id)
                    .await?,
                prompted_content: prompt.content,
                triggered_by: prompt.sender,
            })
            .await
    }
}

/// The receiving half of command forwarding, called by the command-bus
/// consumer and implemented by the harness as [`AgentHarnessService::execute_here`].
pub trait ForwardedCommands: Send + Sync + 'static {
    /// Run a command the transport has targeted to this replica.
    fn execute_forwarded(
        &self,
        session_id: AgentSessionId,
        command: HarnessCommand,
    ) -> impl Future<Output = Result<CommandOutcome>> + Send;
}

impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    ForwardedCommands
    for AgentHarnessService<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
{
    async fn execute_forwarded(
        &self,
        session_id: AgentSessionId,
        command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        self.execute_here(session_id, command).await
    }
}

/// Collapse a harness failure back into the session vocabulary the port speaks.
///
/// A harness error that started life as a session error is unwrapped rather
/// than re-wrapped, so a caller still sees `Disconnected` as `Disconnected`.
fn into_session_error(error: HarnessError) -> AgentSessionError {
    match error {
        HarnessError::Session(error) => error,
        HarnessError::Disconnected(session) => AgentSessionError::Disconnected(session),
        other => AgentSessionError::Unknown(anyhow::anyhow!(other)),
    }
}
