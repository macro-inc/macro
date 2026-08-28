#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{
    AgentSession, AgentSessionId, AuthorKind, CreateAgentSessionParams, MessageId, SandboxSize,
};
use agent_session::domain::ports::{AgentSessionNotificationRecipient, ControlEvent};
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
    AgentKind, AnnounceOrigin, AnnouncePrompt, DeliverAction, HarnessCommand, HarnessDefaults,
    OpenSession, SessionAnnouncement, SpawnContainer, is_macro_staff,
};
use crate::domain::ports::{
    AgentPromptComposer, ChannelPromptContext, ContainerManager, RuntimeConnections,
    SandboxEgressProvisioner, SessionAnnouncer,
};
use crate::domain::sandbox::SandboxResizeEffect;

type SessionWorkers = DashMap<AgentSessionId, mpsc::UnboundedSender<QueuedCommand>>;

struct QueuedCommand {
    command: HarnessCommand,
    completed: oneshot::Sender<Result<()>>,
    /// The caller's span, carried across the queue so the work the worker does
    /// on its own task still hangs off whatever triggered it.
    span: tracing::Span,
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
    defaults: HarnessDefaults,
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
                defaults: defaults.into(),
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
        mut command: HarnessCommand,
    ) -> impl Future<Output = Result<()>> + Send + 'static {
        let caller = tracing::Span::current();
        let result = loop {
            let commands = self.commands(session_id);
            let (completed, result) = oneshot::channel();
            let queued = QueuedCommand {
                command,
                completed,
                span: caller.clone(),
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
            .map_err(into_session_error)
    }

    async fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> agent_session::domain::error::Result<AgentActionId> {
        let action_id = AgentActionId::mint();
        self.execute(
            id,
            HarnessCommand::Deliver(DeliverAction::control(action_id.clone(), event)),
        )
        .await
        .map_err(into_session_error)?;
        Ok(action_id)
    }

    async fn set_sandbox_size(
        &self,
        id: AgentSessionId,
        size: SandboxSize,
    ) -> agent_session::domain::error::Result<()> {
        self.execute(id, HarnessCommand::SetSandboxSize(size))
            .await
            .map_err(into_session_error)
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
        let initial_prompt = if let Some(raw_prompt) = request.prompt.as_deref() {
            let composed_prompt = self
                .inner
                .prompt_composer
                .compose(raw_prompt, None)
                .await
                .map_err(into_session_error)?;
            let mut action = AgentAction::prompt(composed_prompt);
            let AgentAction::Prompt(prompt) = &mut action else {
                unreachable!("a prompt constructor always returns a prompt action");
            };
            prompt.set_name_source(raw_prompt.to_owned());
            Some(action)
        } else {
            None
        };
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
                kind: AgentKind::of(session.bot_id),
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

        if let Some(prompt) = initial_prompt {
            self.inner
                .sessions
                .send_action(
                    session.id,
                    Some(request.owner),
                    prompt,
                    AgentActionId::mint(),
                )
                .await?;
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
    async fn execute(&self, session_id: AgentSessionId, command: HarnessCommand) -> Result<()> {
        match &command {
            HarnessCommand::Open(open)
                if AgentKind::of(open.bot_id) == AgentKind::Cursor
                    && !is_macro_staff(&open.origin.sender) =>
            {
                return Err(AgentSessionError::Forbidden.into());
            }
            HarnessCommand::Deliver(deliver) => {
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::of(session.bot_id) == AgentKind::Cursor
                    && !deliver.actor.as_ref().is_some_and(is_macro_staff)
                {
                    return Err(AgentSessionError::Forbidden.into());
                }
            }
            HarnessCommand::Open(_)
            | HarnessCommand::SetSandboxSize(_)
            | HarnessCommand::Delete => {}
        }

        match command {
            HarnessCommand::Open(command) => self.open(session_id, command).await,
            HarnessCommand::Deliver(command) => self.deliver(session_id, command).await,
            HarnessCommand::SetSandboxSize(size) => self.apply_sandbox_size(session_id, size).await,
            HarnessCommand::Delete => self.delete(session_id).await,
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
        if AgentKind::of(session.bot_id) == AgentKind::SandboxedCoder
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
        let OpenSession { bot_id, origin } = command;
        tracing::Span::current().record("agent.session.id", tracing::field::display(session_id));
        let defaults = self.defaults.for_bot(bot_id);
        let repo_url = defaults.repo_url.clone();
        let sandbox_size = self.sessions.user_sandbox_size(&origin.sender).await?;
        let prior_messages = self
            .load_prompt_context(origin.channel_id, origin.message_id, Some(&origin.sender))
            .await;
        let composed_prompt = self
            .prompt_composer
            .compose(&origin.content, Some(&prior_messages))
            .await?;

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
                model: defaults.model.clone(),
                harness: defaults.harness.clone(),
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

        self.announcer
            .announce(SessionAnnouncement {
                session_id,
                bot_id,
                origin_channel_id: origin.channel_id,
                origin_thread_id: origin.thread_id,
                prompted_message_id: MessageId::first(AuthorKind::User),
                prompted_content: origin.content.clone(),
                triggered_by: origin.sender.clone(),
            })
            .await?;

        let mcp_servers = egress.sandbox.acp_servers();
        let container = match self
            .containers
            .spawn(SpawnContainer {
                session_id,
                kind: AgentKind::of(bot_id),
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
        let mut action = AgentAction::prompt(composed_prompt);
        let AgentAction::Prompt(prompt) = &mut action else {
            unreachable!("a prompt constructor always returns a prompt action");
        };
        prompt.set_name_source(origin.content);
        self.sessions
            .send_action(
                session_id,
                Some(origin.sender),
                action,
                AgentActionId::mint(),
            )
            .await?;
        Ok(())
    }

    /// Do one thing in a session that already exists.
    ///
    /// Three steps, in this order: persist whatever the action changes about
    /// the session, work out whether anyone needs telling, then deliver it.
    /// Announcing before delivery means the chip exists to anchor the turn
    /// the agent streams into.
    #[tracing::instrument(err, skip(self, command), fields(agent.session.id = %session_id))]
    async fn deliver(&self, session_id: AgentSessionId, command: DeliverAction) -> Result<()> {
        let DeliverAction {
            id,
            mut action,
            actor,
            announce,
        } = command;

        let raw_action = action.clone();
        if let AgentAction::Prompt(prompt) = &mut action {
            let raw_prompt = prompt.prompt.clone();
            let prior_messages = if let Some(origin) = announce.as_ref() {
                Some(
                    self.load_prompt_context(origin.channel_id, origin.message_id, actor.as_ref())
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
        }

        let announcement = self
            .announcement(session_id, &raw_action, actor.as_ref(), announce)
            .await?;

        // Announced before the prompt is delivered, as `open` does: the chip
        // anchors the turn the agent is about to stream into, so it has to
        // exist before the response can arrive.
        if let Some(announcement) = announcement {
            self.announcer.announce(announcement).await?;
        }

        match self
            .sessions
            .send_action(session_id, actor.clone(), action.clone(), id.clone())
            .await
        {
            Ok(()) => {}
            // Nothing is attached, so get this session onto a transport and
            // retry against it. Same id: the first attempt never reached the
            // wire.
            Err(AgentSessionError::Disconnected(_)) => {
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::of(session.bot_id).is_managed() {
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
        } = queued;
        let result = inner.execute(session_id, command).instrument(span).await;
        let _ = completed.send(result);
    }
}
