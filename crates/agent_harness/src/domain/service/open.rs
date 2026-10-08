//! Opening sessions: from a channel mention, from the create menu, and for an
//! external runtime that dials in. Each creates the row, provisions egress
//! where there is a sandbox to give it to, and attaches the runtime.

use agent_session::domain::model::session_owner_user;
use agent_session::domain::repository_branch::RepositoryBranch;
use model_owner::Owner;

use super::*;

/// External sessions create the row and announce - the magic-chip message
/// the session's bot posts into the mention's thread, which is where the
/// app renders the session's replies. No sandbox (the runtime dials in) and
/// no first prompt (the runtime sends it through the control endpoint).
/// The announcement is best-effort: a session a runtime is about to serve
/// must not die because the courtesy post failed, most plainly when the bot
/// cannot post in the claimed channel.
impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
> agent_session::domain::ports::SessionOpener
    for AgentHarnessService<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: MessagePromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    async fn open_external_session(
        &self,
        request: agent_session::domain::ports::OpenExternalAgentSession,
    ) -> agent_session::domain::error::Result<AgentSession> {
        let owner_user = session_owner_user(&request.owner)?;
        // The thread linkage is the caller's claim: it is honoured only when
        // the owner can write to that parent and the message sits in it.
        if let Some(thread) = &request.thread {
            self.inner
                .prompt_context
                .authorize_origin(
                    &owner_user,
                    &AnnounceOrigin {
                        reuse_origin_message: thread.reuse_origin_message,
                        parent: thread.parent.clone(),
                        thread_id: thread.thread_id,
                        message_id: thread.message_id,
                    },
                )
                .await
                .map_err(|error| {
                    tracing::warn!(
                        error = ?error,
                        owner = %request.owner,
                        "rejecting an external session whose claimed thread its owner may not post in"
                    );
                    AgentSessionError::Forbidden
                })?;
        }
        let defaults = self.inner.defaults.for_bot(request.bot_id);
        let (model, harness, profile_instructions) = match request.profile {
            Some(profile) => (
                profile.model,
                profile.harness,
                Some(profile.instructions).filter(|value| !value.trim().is_empty()),
            ),
            None => (defaults.model.clone(), defaults.harness.clone(), None),
        };
        let session = self
            .inner
            .sessions
            .create_session(CreateAgentSessionParams {
                warm: false,
                repo_branch: None,
                id: request.id.unwrap_or_else(AgentSessionId::new),
                owner_id: request.owner,
                bot_id: request.bot_id,
                thread_id: request.thread.as_ref().map(|thread| thread.thread_id),
                originating_message_id: request.thread.as_ref().map(|thread| thread.message_id),
                model,
                harness,
                repo_url: request.repo_url,
                workspace: request.workspace,
                sandbox_size: SandboxSize::Default,
                instructions: request.instructions.or(profile_instructions),
                // No egress, so no MCP servers of ours to select from.
                mcp_servers: AgentMcpServers::OwnerConnections,
                // Mint the internal-tool credential when an authenticated
                // runtime binds, and rotate it on each subsequent binding.
                egress_token_hash: None,
                // The thread linkage is the caller's claim, not an observed
                // mention; it must not grant the channel anything.
            })
            .await?;
        self.inner.publish_opened(&session).await;

        if let Some(thread) = request.thread {
            let announce = async {
                let persona = self.inner.reply_persona(&session).await?;
                let announcement = SessionAnnouncement {
                    reuse_origin_message: thread.reuse_origin_message,
                    session_id: session.id,
                    bot_id: request.bot_id,
                    is_coding: persona.is_coding,
                    origin_parent: thread.parent,
                    origin_thread_id: thread.thread_id,
                    origin_message_id: thread.message_id,
                    prompted_message_id: MessageId::first(AuthorKind::User),
                    prompted_content: thread.content,
                    triggered_by: owner_user,
                };
                self.inner.announcer.announce(announcement).await
            };
            if let Err(error) = announce.await {
                tracing::warn!(
                    error = ?error,
                    session = %session.id,
                    "external session announcement failed; the session runs unannounced"
                );
            }
        }

        Ok(session)
    }

    /// Provision the selected managed persona's runtime, open a session on it,
    /// and deliver the first prompt if one came with the request. An omitted
    /// profile uses the deployment's default coding persona.
    ///
    /// Nothing is announced: a managed session opened this way has no
    /// originating mention and no thread to answer back into. The runtime is
    /// spawned before the session is attached because there is nothing to
    /// attach to until it exists.
    async fn open_managed_session(
        &self,
        request: agent_session::domain::ports::OpenManagedSession,
    ) -> agent_session::domain::error::Result<AgentSession> {
        self.open_managed_session_inner(request, false).await
    }

    async fn warm_session(
        &self,
        owner: Owner,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<Option<AgentSession>> {
        self.prepare_warm(owner, id).await
    }

    async fn find_thread_session(
        &self,
        thread_id: macro_uuid::Uuid,
        bot_id: BotId,
    ) -> agent_session::domain::error::Result<Option<AgentSessionId>> {
        match self
            .inner
            .sessions
            .find_for_thread(Some(thread_id), Some(bot_id))
            .await?
        {
            agent_session::domain::model::ThreadSession::CreatedFromThread(session) => {
                Ok(Some(session.id))
            }
            agent_session::domain::model::ThreadSession::None => Ok(None),
        }
    }
}

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: MessagePromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
    Lifecycle: AgentSessionLifecyclePublisher,
    Mentions: PromptMentions,
    Notifier: AgentSessionNotifier,
{
    #[tracing::instrument(err, skip(self, command), fields(
        %session_id,
        bot_id = %command.bot_id,
        message_id = tracing::field::Empty,
        parent = tracing::field::Empty,
        thread_id = tracing::field::Empty,
        agent.trigger.kind = command.origin.kind(),
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
        let actor = origin.actor().clone();
        let announcement = origin.announcement();
        let span = tracing::Span::current();
        span.record("agent.session.id", tracing::field::display(session_id));
        span.record(
            "message_id",
            tracing::field::display(announcement.message_id),
        );
        span.record("parent", tracing::field::debug(&announcement.parent));
        span.record("thread_id", tracing::field::display(announcement.thread_id));
        // Recheck access after the triggering event: a user removed from the
        // parent since mentioning or assigning the agent opens nothing.
        self.prompt_context
            .authorize_origin(&actor, &announcement)
            .await?;

        self.admit_open(
            bot_id,
            runtime.kind.harness_slug().unwrap_or(&runtime.harness),
            &actor,
        )
        .await?;

        // Asked before anything exists for the session: a row whose spawn is
        // bound to fail would be marked disconnected and leave the thread
        // with a chip that never answers. Declining is the bot's reply
        // instead - what the mentioner has to connect, where to do it.
        if let Some(blocker) = self.containers.preflight(runtime.kind, &actor).await? {
            tracing::info!(
                bot_id = %bot_id,
                sender = %actor,
                ?blocker,
                "declining a session its owner is not set up for"
            );
            self.announcer
                .decline(DeclinedMention {
                    bot_id,
                    origin: announcement,
                    triggered_by: actor,
                    blocker,
                })
                .await?;
            return Ok(());
        }

        let defaults = self.defaults.for_bot(bot_id);
        let sandbox_size = self.sessions.user_sandbox_size(&actor).await?;
        // Assignments retain the original task and update policy alongside the
        // profile instructions, including across later turns and reattachments.
        let instructions = origin.session_instructions(&runtime.instructions);

        // Provisioned before the session exists, because the row is what makes
        // the token mean anything: it carries the hash the proxy recognises.
        // Minted here, where the session's owner is in hand, and only here -
        // the token is scoped to this session and spends this person's
        // credentials, so there is nowhere else it could correctly come from.
        let egress = self
            .egress
            .provision(session_id, &actor, &runtime.mcp_servers)
            .await?;

        let session = self
            .sessions
            .create_session(CreateAgentSessionParams {
                warm: false,
                repo_branch: None,
                id: session_id,
                owner_id: Owner::User(actor.clone()),
                bot_id,
                thread_id: Some(announcement.thread_id),
                originating_message_id: Some(announcement.message_id),
                model: runtime.model.clone(),
                harness: runtime
                    .kind
                    .harness_slug()
                    .unwrap_or(&runtime.harness)
                    .to_owned(),
                repo_url: defaults
                    .repo_url
                    .as_ref()
                    .map(|repo| repo.as_str().to_owned()),
                // Managed sandboxes run in the path baked into their image.
                workspace: agent_session::MANAGED_CONTAINER_WORKSPACE.to_owned(),
                sandbox_size,
                instructions,
                // Snapshotted so the proxy enforces exactly what this attach
                // advertised, for as long as the session lives.
                mcp_servers: runtime.mcp_servers.clone(),
                egress_token_hash: Some(egress.session_token_hash),
                // This open came from an observed trigger event.
            })
            .await?;
        self.publish_opened(&session).await;

        let mcp_servers = if runtime.kind == AgentKind::CodexCloud {
            Vec::new()
        } else {
            egress.sandbox.acp_servers()
        };
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
        let permission_policy = self.permission_policy_for(bot_id).await;
        self.sessions
            .attach_session(
                session_id,
                container
                    .mcp_servers(mcp_servers)
                    .permission_policy(permission_policy),
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
                action: origin.into_action(),
                actor: Some(actor),
                announce: Some(announcement),
            },
        )
        .await?;
        Ok(())
    }
}

/// The branch a session starts on when its caller selected a repository but
/// no branch: the repository's own default branch, or `main` for an empty
/// repository. GitHub reports the default branch's name as git holds it, so
/// one that fails to parse belongs to a repository nothing could check out
/// anyway - `main` is as good a guess as any there.
pub(super) fn starting_branch(default_branch: Option<&str>) -> RepositoryBranch {
    default_branch
        .and_then(|branch| RepositoryBranch::parse(branch.to_owned()).ok())
        .unwrap_or_else(|| {
            RepositoryBranch::parse("main".to_owned()).expect("main is a valid branch")
        })
}
