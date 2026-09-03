#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::SessionManagement;
use agent_session::domain::model::{
    AgentSession, AgentSessionId, AuthorKind, CreateAgentSessionParams, MessageId, SandboxSize,
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

type SessionWorkers = DashMap<AgentSessionId, mpsc::UnboundedSender<QueuedCommand>>;

struct QueuedCommand {
    command: HarnessCommand,
    completed: oneshot::Sender<Result<CommandOutcome>>,
    /// The caller's span, carried across the queue so the work the worker does
    /// on its own task still hangs off whatever triggered it.
    span: tracing::Span,
    /// Whether the worker resolves the session's managing replica before
    /// executing. Commands admitted at an ingress route; a command received
    /// *as* a forward executes here unconditionally, which is what makes
    /// forwarding single-hop - two replicas with momentarily different lease
    /// views cannot bounce a command between each other.
    route: bool,
}

/// [`CommandForwarder`], object-safe.
///
/// Held erased inside the service so forwarding does not become an eighth
/// type parameter on every impl block; the public port keeps its natural
/// `impl Future` shape and this shim boxes at the one internal call site.
trait ErasedForwarder: Send + Sync + 'static {
    fn forward<'a>(
        &'a self,
        target: &'a agent_session::domain::model::ReplicaAddress,
        session: AgentSessionId,
        command: HarnessCommand,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<CommandOutcome>> + Send + 'a>>;
}

impl<F: CommandForwarder> ErasedForwarder for F {
    fn forward<'a>(
        &'a self,
        target: &'a agent_session::domain::model::ReplicaAddress,
        session: AgentSessionId,
        command: HarnessCommand,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<CommandOutcome>> + Send + 'a>> {
        Box::pin(CommandForwarder::forward(self, target, session, command))
    }
}

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

    fn enqueue(
        &self,
        session_id: AgentSessionId,
        mut command: HarnessCommand,
        route: bool,
    ) -> impl Future<Output = Result<CommandOutcome>> + Send + 'static {
        let caller = tracing::Span::current();
        let result = loop {
            let commands = self.commands(session_id);
            let (completed, result) = oneshot::channel();
            let queued = QueuedCommand {
                command,
                completed,
                span: caller.clone(),
                route,
            };

            match commands.send(queued) {
                Ok(()) => break result,
                Err(error) => {
                    command = error.0.command;
                    self.workers
                        .remove_if(&session_id, |_, current| current.same_channel(&commands));
                }
            }
        };

        async move {
            result
                .await
                .map_err(|_| HarnessError::CommandWorkerStopped(session_id))?
        }
    }

    fn commands(&self, session_id: AgentSessionId) -> mpsc::UnboundedSender<QueuedCommand> {
        match self.workers.entry(session_id) {
            Entry::Occupied(entry) => entry.get().clone(),
            Entry::Vacant(entry) => {
                let (commands, receiver) = mpsc::unbounded_channel();
                entry.insert(commands.clone());
                self.spawn_worker(session_id, receiver);
                commands
            }
        }
    }

    fn spawn_worker(
        &self,
        session_id: AgentSessionId,
        receiver: mpsc::UnboundedReceiver<QueuedCommand>,
    ) {
        // The worker outlives the call that created it, so it has to carry the
        // subscriber forward itself or every command it runs traces nowhere.
        let inner = self.inner.clone();
        tokio::spawn(run_session_worker(session_id, inner, receiver).with_current_subscriber());
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

/// The receiving half of command forwarding: what the internal forward route
/// calls, implemented by the harness as [`AgentHarnessService::execute_here`].
pub trait ForwardedCommands: Send + Sync + 'static {
    /// Run a command a peer already routed to this replica.
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

/// The harness is what holds a session's live resources, so it is what the
/// control routes notify. Both operations go through the per-session queue, so
/// a teardown cannot land in the middle of an open and a model change cannot
/// overtake the prompt it was meant to follow.
impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    AgentSessionNotificationRecipient
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
    async fn session_deleted(
        &self,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<()> {
        self.execute(id, HarnessCommand::Delete)
            .await
            .map(drop)
            .map_err(into_session_error)
    }

    async fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> agent_session::domain::error::Result<AcceptedControl> {
        let action_id = AgentActionId::mint();
        let outcome = self
            .execute(
                id,
                HarnessCommand::Deliver(DeliverAction::control(action_id, event)),
            )
            .await
            .map_err(into_session_error)?;
        Ok(AcceptedControl {
            action_id,
            disposition: match outcome {
                CommandOutcome::Completed => ControlDisposition::Sent,
                CommandOutcome::Queued => ControlDisposition::Queued,
            },
        })
    }

    /// A local read on purpose: the queue lives beside the session's live
    /// actor, and this replica answers for what it holds. A reader landing on
    /// a non-managing replica sees an empty queue rather than an error.
    async fn queued_controls(
        &self,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<Vec<QueuedControl>> {
        Ok(self.inner.queues.list(id))
    }

    async fn edit_queued_control(
        &self,
        id: AgentSessionId,
        action_id: AgentActionId,
        prompt: String,
        actor: Option<MacroUserIdStr<'static>>,
    ) -> agent_session::domain::error::Result<()> {
        self.execute(
            id,
            HarnessCommand::EditQueued {
                action_id,
                prompt,
                actor,
            },
        )
        .await
        .map(drop)
        .map_err(into_session_error)
    }

    async fn remove_queued_control(
        &self,
        id: AgentSessionId,
        action_id: AgentActionId,
        actor: Option<MacroUserIdStr<'static>>,
    ) -> agent_session::domain::error::Result<()> {
        self.execute(id, HarnessCommand::RemoveQueued { action_id, actor })
            .await
            .map(drop)
            .map_err(into_session_error)
    }

    async fn set_sandbox_size(
        &self,
        id: AgentSessionId,
        size: SandboxSize,
    ) -> agent_session::domain::error::Result<()> {
        self.execute(id, HarnessCommand::SetSandboxSize(size))
            .await
            .map(drop)
            .map_err(into_session_error)
    }

    async fn session_harness(
        &self,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<Option<harness_id::HarnessId>> {
        // The row is the source of truth for which bot the session runs, and
        // the binding resolves the bot's current harness the same way `bind`
        // does at delivery time.
        let session = self.inner.sessions.get_session(id).await?;
        self.inner
            .runtimes
            .bound_harness(session.bot_id)
            .await
            .map_err(AgentSessionError::Unknown)
    }
}

/// The queue drains on the session's own command worker, so both signals
/// only admit an internal command there and return. Admission is synchronous
/// inside [`AgentHarnessService::execute_here`]; the returned future only
/// awaits the completion, which nothing here needs.
impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    agent_session::domain::ports::SessionTurnObserver
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
    fn turn_ended(&self, id: AgentSessionId) {
        drop(self.execute_here(id, HarnessCommand::TurnEnded));
    }

    fn session_stopped(&self, id: AgentSessionId) {
        drop(self.execute_here(id, HarnessCommand::SessionStopped));
    }
}

/// External sessions create the row and announce - the magic-chip message
/// the session's bot posts into the mention's thread, which is where the
/// app renders the session's replies. No sandbox (the runtime dials in) and
/// no first prompt (the runtime sends it through the control endpoint).
/// The announcement is best-effort: a session a runtime is about to serve
/// must not die because the courtesy post failed, most plainly when the bot
/// cannot post in the claimed channel.
impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    agent_session::domain::ports::SessionOpener
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
    async fn open_external_session(
        &self,
        request: agent_session::domain::ports::OpenExternalAgentSession,
    ) -> agent_session::domain::error::Result<AgentSession> {
        let defaults = self.inner.defaults.for_bot(request.bot_id);
        let session = self
            .inner
            .sessions
            .create_session(CreateAgentSessionParams {
                id: AgentSessionId::new(),
                owner_id: request.owner.clone(),
                bot_id: request.bot_id,
                thread_id: request.thread.as_ref().map(|thread| thread.thread_id),
                originating_message_id: request.thread.as_ref().map(|thread| thread.message_id),
                model: defaults.model.clone(),
                harness: defaults.harness.clone(),
                repo_url: request.repo_url,
                workspace: request.workspace,
                sandbox_size: SandboxSize::Default,
                instructions: request.instructions,
                // No sandbox: the runtime dials in and reaches the network on
                // its operator's own terms, so there is no egress token.
                egress_token_hash: None,
                // The thread linkage is the caller's claim, not an observed
                // mention; it must not grant the channel anything.
            })
            .await?;

        if let Some(thread) = request.thread {
            let announcement = SessionAnnouncement {
                session_id: session.id,
                bot_id: request.bot_id,
                origin_channel_id: thread.channel_id,
                origin_thread_id: thread.thread_id,
                origin_message_id: thread.message_id,
                prompted_message_id: MessageId::first(AuthorKind::User),
                prompted_content: thread.content,
                triggered_by: request.owner,
            };
            if let Err(error) = self.inner.announcer.announce(announcement).await {
                tracing::warn!(
                    error = ?error,
                    session = %session.id,
                    "external session announcement failed; the session runs unannounced"
                );
            }
        }

        Ok(session)
    }

    /// Provision the managed-default bot's runtime, open a session on it,
    /// and deliver the first prompt if one came with the request.
    ///
    /// Nothing is announced: a managed session opened this way has no
    /// originating mention and no thread to answer back into. The runtime is
    /// spawned before the session is attached because there is nothing to
    /// attach to until it exists.
    async fn open_managed_session(
        &self,
        request: agent_session::domain::ports::OpenManagedSession,
    ) -> agent_session::domain::error::Result<AgentSession> {
        let defaults = self.inner.defaults.managed();
        let sandbox_size = self
            .inner
            .sessions
            .user_sandbox_size(&request.owner)
            .await?;
        let session_id = AgentSessionId::new();
        // Same ordering as the trigger path's open: the token has to be minted
        // before the row, because the row is what carries the hash that makes
        // it mean anything.
        let egress = self
            .inner
            .egress
            .provision(session_id, &request.owner, &defaults.repo_url)
            .await
            .map_err(into_session_error)?;
        let session = self
            .inner
            .sessions
            .create_session(CreateAgentSessionParams {
                id: session_id,
                owner_id: request.owner.clone(),
                bot_id: defaults.bot_id,
                thread_id: None,
                originating_message_id: None,
                model: defaults.model.clone(),
                harness: defaults.harness.clone(),
                repo_url: Some(defaults.repo_url.clone()),
                // Managed sandboxes run in the path baked into their image.
                workspace: agent_session::MANAGED_CONTAINER_WORKSPACE.to_owned(),
                sandbox_size,
                instructions: request.instructions,
                egress_token_hash: Some(egress.session_token_hash),
            })
            .await?;

        let mcp_servers = egress.sandbox.acp_servers();
        let container = match self
            .inner
            .containers
            .spawn(SpawnContainer {
                session_id: session.id,
                kind: AgentKind::for_session(session.bot_id, &session.harness),
                size: sandbox_size,
                egress: egress.sandbox,
            })
            .await
        {
            Ok(container) => container,
            // The row is already persisted, so a sandbox that never arrived
            // would otherwise leave a session claiming to be live. Same
            // handling as the trigger path's open.
            Err(error) => {
                let _ = self
                    .inner
                    .sessions
                    .mark_disconnected(session.id)
                    .await
                    .inspect_err(|status_error| {
                        tracing::error!(
                            error = ?status_error,
                            session_id = %session.id,
                            "failed to mark an unprovisioned session disconnected"
                        );
                    });
                return Err(into_session_error(error));
            }
        };
        self.inner
            .sessions
            .attach_session(
                session.id,
                RuntimeAttachment::solo(container).mcp_servers(mcp_servers),
            )
            .await?;

        // Raw, through the session's own command worker: dispatch is where a
        // prompt is composed, and the worker is what serializes this first
        // prompt against any control prompt racing the session's birth.
        if let Some(raw_prompt) = request.prompt {
            self.execute_here(
                session.id,
                HarnessCommand::Deliver(DeliverAction {
                    id: AgentActionId::mint(),
                    action: AgentAction::prompt(raw_prompt),
                    actor: Some(request.owner),
                    announce: None,
                }),
            )
            .await
            .map_err(into_session_error)?;
        }

        Ok(session)
    }

    async fn find_thread_session(
        &self,
        thread_id: macro_uuid::Uuid,
        bot_id: BotId,
    ) -> agent_session::domain::error::Result<Option<AgentSessionId>> {
        match self
            .inner
            .sessions
            .find_for_channel(Some(thread_id), Some(bot_id))
            .await?
        {
            agent_session::domain::model::ChannelSession::CreatedFromThread(session) => {
                Ok(Some(session.id))
            }
            agent_session::domain::model::ChannelSession::None => Ok(None),
        }
    }
}

/// Map a queue refusal into the session vocabulary, which is where the
/// control surface's callers read their errors from.
fn queue_result<T>(
    result: std::result::Result<T, QueueError>,
    session_id: AgentSessionId,
) -> Result<T> {
    result.map_err(|error| {
        HarnessError::Session(match error {
            QueueError::NotFound => AgentSessionError::QueuedControlNotFound,
            QueueError::NotEditable => AgentSessionError::QueuedControlNotEditable,
            QueueError::Full => AgentSessionError::ControlQueueFull(session_id),
        })
    })
}

/// Collapse a harness failure back into the session vocabulary the port speaks.
///
/// A harness error that started life as a session error is unwrapped rather
/// than re-wrapped, so a caller still sees `Disconnected` as `Disconnected`.
fn into_session_error(error: HarnessError) -> AgentSessionError {
    match error {
        HarnessError::Session(error) => error,
        other => AgentSessionError::Unknown(anyhow::anyhow!(other)),
    }
}

impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    AgentHarnessInner<
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
    /// Execute where the session's live actor is: locally when nobody (or
    /// this replica) manages it, on the managing peer otherwise.
    ///
    /// A failed forward re-reads the lease once: the one legitimate reason a
    /// live manager refuses its own session is that it died mid-flight, and
    /// then its heartbeat going stale is what lets this replica take over. A
    /// manager that is alive but unreachable stays an error - executing
    /// locally anyway is how two actors end up on one session.
    /// The routing decision is recorded on the span, not only logged: which of
    /// the three answers the lease gave, which peer it named, and whether the
    /// command left this process. Those are the fields you group by when a
    /// replica is mishandling commands, and a log line cannot be aggregated.
    #[tracing::instrument(
        err,
        skip(self, command),
        fields(
            %session_id,
            agent.session.management = tracing::field::Empty,
            agent.session.manager_replica = tracing::field::Empty,
            agent.command.forwarded = tracing::field::Empty,
            agent.command.stale_fallback = tracing::field::Empty,
        )
    )]
    async fn route_then_execute(
        &self,
        session_id: AgentSessionId,
        command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        let span = tracing::Span::current();
        // Open never routes: it is what creates the session row this routing
        // would read, and a fresh id has no manager to defer to.
        if matches!(command, HarnessCommand::Open(_)) {
            span.record("agent.session.management", "open");
            span.record("agent.command.forwarded", false);
            return self.execute(session_id, command).await;
        }
        let manager = match self.sessions.management(session_id).await? {
            SessionManagement::Unmanaged => {
                span.record("agent.session.management", "unmanaged");
                span.record("agent.command.forwarded", false);
                return self.execute(session_id, command).await;
            }
            SessionManagement::Ours => {
                span.record("agent.session.management", "ours");
                span.record("agent.command.forwarded", false);
                return self.execute(session_id, command).await;
            }
            SessionManagement::Peer(manager) => manager,
        };
        span.record("agent.session.management", "peer");
        span.record(
            "agent.session.manager_replica",
            tracing::field::display(manager.replica),
        );
        let Some(address) = manager.address else {
            // Recorded false deliberately: the command stayed here, but as an
            // error rather than a local execution.
            span.record("agent.command.forwarded", false);
            return Err(HarnessError::ManagerUnreachable(session_id));
        };
        span.record("agent.command.forwarded", true);
        tracing::info!(%session_id, peer = %manager.replica, "forwarding an agent session command");
        match self
            .forwarder
            .forward(&address, session_id, command.clone())
            .await
        {
            Ok(outcome) => Ok(outcome),
            Err(forward_error) => match self.sessions.management(session_id).await? {
                SessionManagement::Unmanaged | SessionManagement::Ours => {
                    // Worth aggregating rather than only logging: routine
                    // fallbacks mean heartbeats are not keeping up, which is a
                    // different problem from an occasional dead peer.
                    span.record("agent.command.stale_fallback", true);
                    tracing::warn!(
                        error = ?forward_error,
                        %session_id,
                        "the managing replica went stale mid-forward; executing locally"
                    );
                    self.execute(session_id, command).await
                }
                SessionManagement::Peer(_) => Err(forward_error),
            },
        }
    }

    async fn execute(
        &self,
        session_id: AgentSessionId,
        command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        match &command {
            HarnessCommand::Open(open)
                if AgentKind::of(open.bot_id) == AgentKind::SandboxedCoder
                    && !is_macro_staff(&open.origin.sender) =>
            {
                return Err(AgentSessionError::Forbidden.into());
            }
            // The queue mutations sit behind the same staff gate as delivery:
            // an edited entry is delivered later under its original identity,
            // so rewriting (or dropping) what a Daytona session is about to
            // run is the same privilege as prompting it.
            HarnessCommand::Deliver(DeliverAction { actor, .. })
            | HarnessCommand::EditQueued { actor, .. }
            | HarnessCommand::RemoveQueued { actor, .. } => {
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::of(session.bot_id) == AgentKind::SandboxedCoder
                    && !actor.as_ref().is_some_and(is_macro_staff)
                {
                    return Err(AgentSessionError::Forbidden.into());
                }
            }
            HarnessCommand::Open(_)
            | HarnessCommand::TurnEnded
            | HarnessCommand::SessionStopped
            | HarnessCommand::SetSandboxSize(_)
            | HarnessCommand::Delete => {}
        }

        match command {
            HarnessCommand::Open(command) => {
                self.open(session_id, command).await?;
                Ok(CommandOutcome::Completed)
            }
            // Turn-occupying actions go through the queue - the running
            // turn's end is what dispatches them. Everything else delivers
            // now: a stop rides alongside the turn it cancels, and that
            // turn's cancelled answer is an ordinary turn end.
            HarnessCommand::Deliver(command) if command.action.occupies_turn() => {
                self.enqueue_then_dispatch(session_id, command).await
            }
            HarnessCommand::Deliver(command) => {
                self.deliver(session_id, command).await?;
                Ok(CommandOutcome::Completed)
            }
            HarnessCommand::EditQueued {
                action_id,
                prompt,
                actor,
            } => {
                queue_result(
                    self.queues
                        .edit_prompt(session_id, action_id, prompt, actor),
                    session_id,
                )?;
                self.publish_queue(session_id).await;
                Ok(CommandOutcome::Completed)
            }
            HarnessCommand::RemoveQueued { action_id, .. } => {
                queue_result(self.queues.remove(session_id, action_id), session_id)?;
                self.publish_queue(session_id).await;
                Ok(CommandOutcome::Completed)
            }
            HarnessCommand::TurnEnded => {
                self.busy.remove(&session_id);
                let dispatched = self.dispatch_next(session_id).await;
                // Published whatever dispatching did: a claim, a requeued
                // failure, and an emptied queue are all changes a viewer is
                // watching for.
                self.publish_queue(session_id).await;
                dispatched?;
                Ok(CommandOutcome::Completed)
            }
            HarnessCommand::SessionStopped => {
                self.busy.remove(&session_id);
                Ok(CommandOutcome::Completed)
            }
            HarnessCommand::SetSandboxSize(size) => {
                self.apply_sandbox_size(session_id, size).await?;
                Ok(CommandOutcome::Completed)
            }
            HarnessCommand::Delete => {
                self.delete(session_id).await?;
                // The queue and busy mark die with the session: a deleted
                // session's entries will never dispatch, and leaving them
                // would leak them for the life of the process. The published
                // empty snapshot is the viewers' goodbye.
                self.busy.remove(&session_id);
                self.queues.drop_session(session_id);
                self.publish_queue(session_id).await;
                Ok(CommandOutcome::Completed)
            }
        }
    }

    /// Queue a turn-occupying action, and dispatch the head of the queue
    /// right away when no turn is running.
    ///
    /// The dispatched entry is usually the one just queued, but not
    /// necessarily: entries can linger from a drain that failed, and FIFO
    /// order holds regardless. The outcome reports what happened to *this*
    /// action - still waiting, or on the wire.
    async fn enqueue_then_dispatch(
        &self,
        session_id: AgentSessionId,
        command: DeliverAction,
    ) -> Result<CommandOutcome> {
        let action_id = command.id;
        queue_result(
            self.queues.enqueue(
                session_id,
                QueuedEntry {
                    action_id,
                    action: command.action,
                    actor: command.actor,
                    announce: command.announce,
                    announced: false,
                    created_at: chrono::Utc::now(),
                },
            ),
            session_id,
        )?;

        let dispatched = if self.busy.contains_key(&session_id) {
            Ok(())
        } else {
            self.dispatch_next(session_id).await
        };
        self.publish_queue(session_id).await;
        dispatched?;

        Ok(if self.queues.contains(session_id, action_id) {
            CommandOutcome::Queued
        } else {
            CommandOutcome::Completed
        })
    }

    /// Push the queue as it now stands to the session's viewers.
    ///
    /// Best-effort, like every realtime publish: a dropped snapshot costs a
    /// viewer liveness until the next change, and the queue itself is intact -
    /// so this logs and never fails the command it rides on.
    async fn publish_queue(&self, session_id: AgentSessionId) {
        let _ = self
            .sessions
            .publish_queue_changed(AgentSessionQueueChanged {
                agent_session_id: session_id,
                entries: self.queues.list(session_id),
            })
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error = ?error,
                    %session_id,
                    "failed to publish an agent session queue change"
                );
            });
    }

    /// Deliver the oldest queued action, marking the session busy on success.
    ///
    /// Composition runs first so a lexical failure never posts a chip for a
    /// prompt that will not reach the agent. The chip is then announced
    /// (from the raw text) before delivery, so it exists to anchor the turn
    /// the agent streams into - and it is announced *at most once* per
    /// entry: the claimed entry remembers a successful announce, so a
    /// dispatch that fails after the chip posted retries without posting a
    /// second one.
    ///
    /// A failed dispatch puts the entry back at the front: it stays next in
    /// line for the next turn end or the next prompt, and stays visible in
    /// the queue meanwhile. The error still propagates, so a caller whose
    /// own action triggered this dispatch hears about it.
    #[tracing::instrument(err, skip(self), fields(%session_id))]
    async fn dispatch_next(&self, session_id: AgentSessionId) -> Result<()> {
        let Some(mut entry) = self.queues.claim_next(session_id) else {
            return Ok(());
        };

        // Compose a copy: the queued entry stays raw so a retry still edits
        // and re-composes the user's text, and the chip (below) still shows
        // what they typed rather than the composed payload.
        let mut composed = entry.action.clone();
        if let Err(error) = self
            .compose_action(&mut composed, entry.actor.as_ref(), entry.announce.as_ref())
            .await
        {
            self.queues.requeue_front(session_id, entry);
            return Err(error);
        }

        if !entry.announced {
            let announcement = match self
                .announcement(
                    session_id,
                    &entry.action,
                    entry.actor.as_ref(),
                    entry.announce.clone(),
                )
                .await
            {
                Ok(announcement) => announcement,
                Err(error) => {
                    self.queues.requeue_front(session_id, entry);
                    return Err(error);
                }
            };
            if let Some(announcement) = announcement {
                if let Err(error) = self.announcer.announce(announcement).await {
                    self.queues.requeue_front(session_id, entry);
                    return Err(error);
                }
                entry.announced = true;
            }
        }

        let command = DeliverAction {
            id: entry.action_id,
            action: composed,
            actor: entry.actor.clone(),
            announce: entry.announce.clone(),
        };
        match self.deliver(session_id, command).await {
            Ok(()) => {
                self.busy.insert(session_id, ());
                Ok(())
            }
            Err(error) => {
                self.queues.requeue_front(session_id, entry);
                Err(error)
            }
        }
    }

    /// The MCP servers to advertise when reattaching to an existing container.
    ///
    /// The raw session token exists in exactly one place after spawn - the
    /// container's own environment - so it is read back from there and wrapped
    /// in a fresh listing of the owner's connected servers. A container that
    /// holds no token (a provider whose sessions carry no egress environment,
    /// or a sandbox from before tokens existed) gets no servers, which is
    /// also everything it could do with them.
    #[tracing::instrument(err, skip(self, owner), fields(%session_id, %owner))]
    async fn resumed_mcp_servers(
        &self,
        session_id: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<Vec<agent_client_protocol::schema::v1::McpServer>> {
        let Some(session_token) = self.containers.session_token(session_id).await? else {
            tracing::debug!("container holds no egress token; restoring no MCP servers");
            return Ok(Vec::new());
        };
        Ok(self
            .egress
            .restore(owner, session_token)
            .await?
            .acp_servers())
    }

    /// Release everything the session holds, then delete it.
    ///
    /// The durable delete goes last on purpose. Crashing between the two
    /// leaves a session whose container is gone, which `resume` heals by
    /// spawning a new one; the other order leaves a paid sandbox that nothing
    /// knows to reap.
    #[tracing::instrument(err, skip(self), fields(%session_id))]
    async fn delete(&self, session_id: AgentSessionId) -> Result<()> {
        self.sessions.close_session(session_id).await?;
        self.containers.teardown(session_id).await?;
        self.sessions.delete_session(session_id).await?;
        Ok(())
    }

    /// Apply `size` to this session's sandbox and remember it as the owner's default.
    ///
    /// The container manager reports whether the change is in-place, needs a
    /// stop, or is unsupported. Disk is never changed.
    #[tracing::instrument(err, skip(self), fields(%session_id, %size))]
    async fn apply_sandbox_size(
        &self,
        session_id: AgentSessionId,
        size: SandboxSize,
    ) -> Result<()> {
        let session = self.sessions.get_session(session_id).await?;
        let effect = self.containers.resize_effect(session.sandbox_size, size);
        // Only a sandboxed coder has a sandbox to act on: a Cursor session
        // runs in Cursor's cloud, the in-memory bot has no sandbox, and an
        // external bot provisions its own. For all three, the size is only
        // recorded below as a preference.
        if AgentKind::for_session(session.bot_id, &session.harness) == AgentKind::SandboxedCoder
            && effect != SandboxResizeEffect::NoOp
        {
            if effect == SandboxResizeEffect::Restart {
                self.sessions.close_session(session_id).await?;
            }
            self.containers.resize(session_id, size).await?;
            if effect == SandboxResizeEffect::Restart {
                let container = self.containers.resume(session_id).await?;
                let mcp_servers = self
                    .resumed_mcp_servers(session_id, &session.owner_id)
                    .await?;
                self.sessions
                    .attach_session(
                        session_id,
                        RuntimeAttachment::solo(container).mcp_servers(mcp_servers),
                    )
                    .await?;
            }
        }
        self.sessions.set_sandbox_size(session_id, size).await?;
        self.sessions
            .set_user_sandbox_size(&session.owner_id, size)
            .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, command), fields(
        %session_id,
        bot_id = %command.bot_id,
        message_id = %command.origin.message_id,
        channel_id = %command.origin.channel_id,
        thread_id = %command.origin.thread_id,
        agent.trigger.kind = "mention",
        agent.session.id = tracing::field::Empty,
    ))]
    async fn open(&self, session_id: AgentSessionId, command: OpenSession) -> Result<()> {
        let OpenSession {
            bot_id,
            runtime,
            origin,
        } = command;
        tracing::Span::current().record("agent.session.id", tracing::field::display(session_id));
        let defaults = self.defaults.for_bot(bot_id);
        let repo_url = defaults.repo_url.clone();
        let sandbox_size = self.sessions.user_sandbox_size(&origin.sender).await?;

        // Provisioned before the session exists, because the row is what makes
        // the token mean anything: it carries the hash the proxy recognises.
        // Minted here, where the session's owner is in hand, and only here -
        // the token is scoped to this session and spends this person's
        // credentials, so there is nowhere else it could correctly come from.
        let egress = self
            .egress
            .provision(session_id, &origin.sender, &repo_url)
            .await?;

        self.sessions
            .create_session(CreateAgentSessionParams {
                id: session_id,
                owner_id: origin.sender.clone(),
                bot_id,
                thread_id: Some(origin.thread_id),
                originating_message_id: Some(origin.message_id),
                model: runtime.model.clone(),
                harness: runtime.harness.clone(),
                repo_url: Some(repo_url.clone()),
                // Managed sandboxes run in the path baked into their image.
                workspace: agent_session::MANAGED_CONTAINER_WORKSPACE.to_owned(),
                sandbox_size,
                // A mention carries no instructions: the prompt is whatever
                // was said in the channel, and nothing there states how the
                // runtime should work.
                instructions: None,
                egress_token_hash: Some(egress.session_token_hash),
                // This open came from the trigger pipeline seeing the mention.
            })
            .await?;

        let mcp_servers = egress.sandbox.acp_servers();
        let container = match self
            .containers
            .spawn(SpawnContainer {
                session_id,
                kind: runtime.kind,
                size: sandbox_size,
                egress: egress.sandbox,
            })
            .await
        {
            Ok(container) => container,
            Err(error) => {
                let _ = self
                    .sessions
                    .mark_disconnected(session_id)
                    .await
                    .inspect_err(|status_error| {
                        tracing::error!(
                            error = ?status_error,
                            %session_id,
                            "failed to mark an unprovisioned session disconnected"
                        );
                    });
                return Err(error);
            }
        };
        self.sessions
            .attach_session(
                session_id,
                RuntimeAttachment::solo(container).mcp_servers(mcp_servers),
            )
            .await?;
        // The first prompt goes through the same door as every later one:
        // queued raw, then dispatched - which is where it is composed with
        // channel context and announced as the chip the replies render into.
        // One door is what holds the one-turn-in-flight invariant from the
        // session's very first action.
        self.enqueue_then_dispatch(
            session_id,
            DeliverAction {
                id: AgentActionId::mint(),
                action: AgentAction::prompt(origin.content),
                actor: Some(origin.sender),
                announce: Some(AnnounceOrigin {
                    channel_id: origin.channel_id,
                    thread_id: origin.thread_id,
                    message_id: origin.message_id,
                }),
            },
        )
        .await?;
        Ok(())
    }

    /// Deliver one already-composed action to the session's runtime.
    ///
    /// Announcing and composition are not this function's business: both
    /// belong to dispatch (see [`Self::dispatch_next`]), which is the only
    /// path a turn-occupying prompt travels. Non-turn-occupying actions
    /// (set-model, stop) arrive here directly and need neither.
    #[tracing::instrument(err, skip(self, command), fields(agent.session.id = %session_id))]
    async fn deliver(&self, session_id: AgentSessionId, command: DeliverAction) -> Result<()> {
        let DeliverAction {
            id,
            action,
            actor,
            announce: _,
        } = command;

        match self
            .sessions
            .send_action(session_id, actor.clone(), action.clone(), id)
            .await
        {
            Ok(()) => {}
            // Nothing is attached, so get this session onto a transport and
            // retry against it. Same id: the first attempt never reached the
            // wire.
            Err(AgentSessionError::Disconnected(_)) => {
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::for_session(session.bot_id, &session.harness).is_managed() {
                    let container = self.containers.resume(session_id).await?;
                    let mcp_servers = self
                        .resumed_mcp_servers(session_id, &session.owner_id)
                        .await?;
                    self.sessions
                        .attach_session(
                            session_id,
                            RuntimeAttachment::solo(container).mcp_servers(mcp_servers),
                        )
                        .await?;
                } else {
                    // An external runtime is not ours to start - only its
                    // operator can dial - but a bot whose runtime is already
                    // connected just has not had this session bound to it
                    // yet. That is the ordinary case: sessions bind when they
                    // are prompted, not when the runtime dials, so the first
                    // prompt after a reconnect is what restores the session.
                    let Some(attachment) = self.runtimes.bind(session.bot_id, session_id).await
                    else {
                        // Kept in the session vocabulary so transports report
                        // it as a disconnect, not an internal error.
                        return Err(HarnessError::Session(AgentSessionError::Disconnected(
                            session_id,
                        )));
                    };
                    self.sessions.attach_session(session_id, attachment).await?;
                }
                self.sessions
                    .send_action(session_id, actor, action, id)
                    .await?;
            }
            Err(error) => return Err(error.into()),
        }
        Ok(())
    }

    /// Compose a prompt in place. Compact and other actions are left as-is.
    ///
    /// Channel context is loaded when the prompt named an origin; a lookup
    /// failure still composes, with empty history, so a transient context
    /// outage cannot eat the prompt.
    async fn compose_action(
        &self,
        action: &mut AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<&AnnounceOrigin>,
    ) -> Result<()> {
        let AgentAction::Prompt(prompt) = action else {
            return Ok(());
        };
        let raw_prompt = prompt.prompt.clone();
        let prior_messages = if let Some(origin) = announce {
            Some(
                self.load_prompt_context(origin.channel_id, origin.message_id, actor)
                    .await,
            )
        } else {
            None
        };
        prompt.prompt = self
            .prompt_composer
            .compose(&raw_prompt, prior_messages.as_deref())
            .await?;
        prompt.set_name_source(raw_prompt);
        Ok(())
    }

    async fn load_prompt_context(
        &self,
        channel_id: macro_uuid::Uuid,
        message_id: macro_uuid::Uuid,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> Vec<crate::domain::model::PriorChannelMessage> {
        async {
            if let Some(actor) = actor {
                self.prompt_context
                    .authorize_member(actor, channel_id)
                    .await?;
            }
            self.prompt_context
                .preceding_messages(channel_id, message_id)
                .await
        }
        .await
        .inspect_err(|error| {
            // Trigger events are admitted at-most-once. Context is useful,
            // but a transient lookup failure must not discard the prompt.
            tracing::warn!(
                error = ?error,
                %channel_id,
                %message_id,
                "sending agent prompt without channel history"
            );
        })
        .unwrap_or_default()
    }

    /// Who, if anyone, should be told that this landed.
    ///
    /// Only prompts are announced, and only when the caller named an origin
    /// to answer back into. A session has no channel of its own, so an origin
    /// is never redundant.
    async fn announcement(
        &self,
        session_id: AgentSessionId,
        action: &AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<AnnounceOrigin>,
    ) -> Result<Option<SessionAnnouncement>> {
        let (Some(origin), Some(triggered_by), AgentAction::Prompt(prompt)) =
            (announce, actor, action)
        else {
            return Ok(None);
        };

        // The announcement posts as the session's own bot, which only the
        // row remembers.
        let session = self.sessions.get_session(session_id).await?;

        Ok(Some(SessionAnnouncement {
            session_id,
            bot_id: session.bot_id,
            origin_channel_id: origin.channel_id,
            origin_thread_id: origin.thread_id,
            origin_message_id: origin.message_id,
            prompted_message_id: self.sessions.next_prompt_message_id(session_id).await?,
            prompted_content: prompt.prompt.clone(),
            triggered_by: triggered_by.clone(),
        }))
    }
}

async fn run_session_worker<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
>(
    session_id: AgentSessionId,
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
    mut receiver: mpsc::UnboundedReceiver<QueuedCommand>,
) where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
{
    while let Some(queued) = receiver.recv().await {
        let QueuedCommand {
            command,
            completed,
            span,
            route,
        } = queued;
        let result = if route {
            inner
                .route_then_execute(session_id, command)
                .instrument(span)
                .await
        } else {
            inner.execute(session_id, command).instrument(span).await
        };
        let _ = completed.send(result);
    }
}
