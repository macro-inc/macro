//! Opening sessions: from a channel mention, from the create menu, and for an
//! external runtime that dials in. Each creates the row, provisions egress
//! where there is a sandbox to give it to, and attaches the runtime.

use super::*;

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
                // No egress, so no MCP servers of ours to select from.
                mcp_servers: AgentMcpServers::OwnerConnections,
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
            .provision(
                session_id,
                &request.owner,
                &defaults.repo_url,
                &AgentMcpServers::OwnerConnections,
            )
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
                // A fixed system agent has no configuration to select from.
                mcp_servers: AgentMcpServers::OwnerConnections,
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
    #[tracing::instrument(err, skip(self, command), fields(
        %session_id,
        bot_id = %command.bot_id,
        message_id = %command.origin.message_id,
        channel_id = %command.origin.channel_id,
        thread_id = %command.origin.thread_id,
        agent.trigger.kind = "mention",
        agent.session.id = tracing::field::Empty,
    ))]
    pub(super) async fn open(
        &self,
        session_id: AgentSessionId,
        command: OpenSession,
    ) -> Result<()> {
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
            .provision(session_id, &origin.sender, &repo_url, &runtime.mcp_servers)
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
                // Snapshotted so the proxy enforces exactly what this attach
                // advertised, for as long as the session lives.
                mcp_servers: runtime.mcp_servers.clone(),
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
}
