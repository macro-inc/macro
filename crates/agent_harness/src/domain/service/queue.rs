//! The per-session command queue: admission, the worker that drains it one
//! command at a time, and routing to the replica that holds the session.

use super::*;

pub(super) type SessionWorkers = DashMap<AgentSessionId, mpsc::UnboundedSender<QueuedCommand>>;

pub(super) struct QueuedCommand {
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
pub(super) trait ErasedForwarder: Send + Sync + 'static {
    fn forward<'a>(
        &'a self,
        session: AgentSessionId,
        command: HarnessCommand,
        target: crate::domain::ports::CommandTarget,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<CommandOutcome>> + Send + 'a>>;
}

impl<F: CommandForwarder> ErasedForwarder for F {
    fn forward<'a>(
        &'a self,
        session: AgentSessionId,
        command: HarnessCommand,
        target: crate::domain::ports::CommandTarget,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<CommandOutcome>> + Send + 'a>> {
        Box::pin(CommandForwarder::forward(self, session, command, target))
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
    pub(super) fn enqueue(
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

    pub(super) fn commands(
        &self,
        session_id: AgentSessionId,
    ) -> mpsc::UnboundedSender<QueuedCommand> {
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

    pub(super) fn spawn_worker(
        &self,
        session_id: AgentSessionId,
        receiver: mpsc::UnboundedReceiver<QueuedCommand>,
    ) {
        // The worker outlives the call that created it, so it has to carry the
        // subscriber forward itself or every command it runs traces nowhere.
        let inner = self.inner.clone();
        tokio::spawn(run_session_worker(session_id, inner, receiver).with_current_subscriber());
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
        )
    )]
    pub(super) async fn route_then_execute(
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
                let session = self.sessions.get_session(session_id).await?;
                if AgentKind::for_session(session.bot_id, &session.harness) != AgentKind::External {
                    return self.execute(session_id, command).await;
                }
                let Some(harness) = self
                    .runtimes
                    .bound_harness(session.bot_id)
                    .await
                    .map_err(AgentSessionError::Unknown)?
                else {
                    return self.execute(session_id, command).await;
                };
                if self.runtimes.is_connected(harness) {
                    return self.execute(session_id, command).await;
                }
                span.record("agent.command.forwarded", true);
                return self
                    .forwarder
                    .forward(
                        session_id,
                        command,
                        crate::domain::ports::CommandTarget::Harness(harness),
                    )
                    .await;
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
        span.record("agent.command.forwarded", true);
        tracing::info!(%session_id, peer = %manager.replica, "forwarding an agent session command");
        self.forwarder
            .forward(
                session_id,
                command,
                crate::domain::ports::CommandTarget::Replica(manager.replica),
            )
            .await
    }

    pub(super) async fn execute(
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
    pub(super) async fn enqueue_then_dispatch(
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
    pub(super) async fn publish_queue(&self, session_id: AgentSessionId) {
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
    pub(super) async fn dispatch_next(&self, session_id: AgentSessionId) -> Result<()> {
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
}

/// Map a queue refusal into the session vocabulary, which is where the
/// control surface's callers read their errors from.
pub(super) fn queue_result<T>(
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

pub(super) async fn run_session_worker<
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
