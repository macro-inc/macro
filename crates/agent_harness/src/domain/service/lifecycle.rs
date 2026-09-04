//! A session after it is open: control events from the app, sandbox sizing,
//! turn boundaries, and teardown.

use super::*;

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
    /// The MCP servers to advertise when reattaching to an existing container.
    ///
    /// The raw session token exists in exactly one place after spawn - the
    /// container's own environment - so it is read back from there and wrapped
    /// in a fresh listing of the owner's connected servers. A container that
    /// holds no token (a provider whose sessions carry no egress environment,
    /// or a sandbox from before tokens existed) gets no servers, which is
    /// also everything it could do with them.
    #[tracing::instrument(err, skip(self, owner), fields(%session_id, %owner))]
    pub(super) async fn resumed_mcp_servers(
        &self,
        session_id: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<Vec<agent_client_protocol::schema::v1::McpServer>> {
        let Some(session_token) = self.containers.session_token(session_id).await? else {
            tracing::debug!("container holds no egress token; restoring no MCP servers");
            return Ok(Vec::new());
        };
        Ok(self
            .egress
            .restore(owner, session_token, selection)
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
    pub(super) async fn delete(&self, session_id: AgentSessionId) -> Result<()> {
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
    pub(super) async fn apply_sandbox_size(
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
                    .resumed_mcp_servers(session_id, &session.owner_id, &session.mcp_servers)
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
}
