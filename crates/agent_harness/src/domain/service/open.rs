//! Opening sessions: from a channel mention, from the create menu, and for an
//! external runtime that dials in. Each creates the row, provisions egress
//! where there is a sandbox to give it to, and attaches the runtime.

use agent_session::domain::ports::SelectedManagedPersona;
use agent_session::domain::repository_branch::RepositoryBranch;

use super::*;
use crate::domain::model::SessionRepository;

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
        // The thread linkage is the caller's claim: it is honoured only when
        // the owner can write to that parent and the message sits in it.
        if let Some(thread) = &request.thread {
            self.inner
                .prompt_context
                .authorize_origin(
                    &request.owner,
                    &AnnounceOrigin {
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
        let (model, harness) = match request.profile {
            Some(profile) => (profile.model, profile.harness),
            None => (defaults.model.clone(), defaults.harness.clone()),
        };
        let session = self
            .inner
            .sessions
            .create_session(CreateAgentSessionParams {
                repo_branch: None,
                id: AgentSessionId::new(),
                owner_id: request.owner.clone(),
                bot_id: request.bot_id,
                thread_id: request.thread.as_ref().map(|thread| thread.thread_id),
                originating_message_id: request.thread.as_ref().map(|thread| thread.message_id),
                model,
                harness,
                repo_url: request.repo_url,
                workspace: request.workspace,
                sandbox_size: SandboxSize::Default,
                instructions: request.instructions,
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
            let announcement = SessionAnnouncement {
                session_id: session.id,
                bot_id: request.bot_id,
                origin_parent: thread.parent,
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
        let managed_defaults = self.inner.defaults.managed();
        let (bot_id, model, harness, instructions, mut mcp_servers) = match request.profile {
            Some(SelectedManagedPersona {
                bot_id,
                profile: Some(profile),
            }) => (
                bot_id,
                profile.model,
                profile.harness,
                Some(profile.instructions).filter(|value| !value.trim().is_empty()),
                profile.mcp_servers,
            ),
            // A fixed system bot picked by name runs on the deployment's
            // defaults for it, the same way a channel mention would open it.
            Some(SelectedManagedPersona {
                bot_id,
                profile: None,
            }) => {
                let defaults = self.inner.defaults.for_bot(bot_id);
                (
                    bot_id,
                    defaults.model.clone(),
                    defaults.harness.clone(),
                    request.instructions,
                    AgentMcpServers::OwnerConnections,
                )
            }
            None => (
                managed_defaults.bot_id,
                managed_defaults.model.clone(),
                managed_defaults.harness.clone(),
                request.instructions,
                AgentMcpServers::OwnerConnections,
            ),
        };
        let kind = AgentKind::for_session(bot_id, &harness);
        if kind == AgentKind::CodexCloud {
            mcp_servers = AgentMcpServers::Selected {
                servers: Vec::new(),
            };
        }
        // Explicit source choices are a domain decision, before any session or egress grant exists.
        let selected_repo = if let Some(url) = request.repo_url.as_deref() {
            if kind != AgentKind::Cursor {
                return Err(
                    agent_session::domain::error::AgentSessionError::InvalidRepositorySelection(
                        "repository selection is supported for Cursor coding agents",
                    ),
                );
            }
            let repo = SessionRepository::parse(url).ok_or(
                agent_session::domain::error::AgentSessionError::InvalidRepositorySelection(
                    "select a valid GitHub repository",
                ),
            )?;
            let repositories = self
                .repositories
                .as_ref()
                .ok_or(agent_session::domain::error::AgentSessionError::Forbidden)?;
            let reachable = repositories
                .for_user(&request.owner)
                .await
                .map_err(into_session_error)?;
            let listed = reachable
                .iter()
                .find(|allowed| allowed.url.eq_ignore_ascii_case(repo.as_str()))
                .ok_or(agent_session::domain::error::AgentSessionError::Forbidden)?;
            // The caller's branch, or the one the repository's own clones start on.
            let branch = request
                .repo_branch
                .clone()
                .unwrap_or_else(|| starting_branch(listed.default_branch.as_deref()));
            Some((repo, branch))
        } else {
            if request.repo_branch.is_some() {
                return Err(
                    agent_session::domain::error::AgentSessionError::InvalidRepositorySelection(
                        "select a repository before choosing a branch",
                    ),
                );
            }
            None
        };
        let defaults = self.inner.defaults.for_bot(bot_id);
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
            .provision(session_id, &request.owner, &mcp_servers)
            .await
            .map_err(into_session_error)?;
        let session = self
            .inner
            .sessions
            .create_session(CreateAgentSessionParams {
                repo_branch: selected_repo.as_ref().map(|(_, branch)| branch.clone()),
                id: session_id,
                owner_id: request.owner.clone(),
                bot_id,
                thread_id: None,
                originating_message_id: None,
                model,
                harness,
                // Whatever this bot's sessions work in: the deployment's
                // repository, or nothing for a bot whose sessions work
                // somewhere this deployment does not name.
                repo_url: selected_repo
                    .as_ref()
                    .map(|(repo, _)| repo)
                    .or(defaults.repo_url.as_ref())
                    .map(|repo| repo.as_str().to_owned()),
                // Managed sandboxes run in the path baked into their image.
                workspace: agent_session::MANAGED_CONTAINER_WORKSPACE.to_owned(),
                sandbox_size,
                instructions,
                mcp_servers,
                egress_token_hash: Some(egress.session_token_hash),
            })
            .await?;
        self.inner.publish_opened(&session).await;

        let mcp_servers = if kind == AgentKind::CodexCloud {
            Vec::new()
        } else {
            egress.sandbox.acp_servers()
        };
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
        let permission_policy = self.inner.permission_policy_for(session.bot_id).await;
        self.inner
            .sessions
            .attach_session(
                session.id,
                container
                    .mcp_servers(mcp_servers)
                    .permission_policy(permission_policy),
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
        message_id = %command.origin.message_id,
        parent = ?command.origin.parent,
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
        // The mention was observed, but the sender's access is checked now:
        // a user removed from the parent since posting opens nothing.
        self.prompt_context
            .authorize_origin(
                &origin.sender,
                &AnnounceOrigin {
                    parent: origin.parent.clone(),
                    thread_id: origin.thread_id,
                    message_id: origin.message_id,
                },
            )
            .await?;

        // Asked before anything exists for the session: a row whose spawn is
        // bound to fail would be marked disconnected and leave the thread
        // with a chip that never answers. Declining is the bot's reply
        // instead - what the mentioner has to connect, where to do it.
        if let Some(blocker) = self
            .containers
            .preflight(runtime.kind, &origin.sender)
            .await?
        {
            tracing::info!(
                bot_id = %bot_id,
                sender = %origin.sender,
                ?blocker,
                "declining a mention its sender is not set up for"
            );
            self.announcer
                .decline(DeclinedMention {
                    bot_id,
                    origin: AnnounceOrigin {
                        parent: origin.parent,
                        thread_id: origin.thread_id,
                        message_id: origin.message_id,
                    },
                    triggered_by: origin.sender,
                    blocker,
                })
                .await?;
            return Ok(());
        }

        let defaults = self.defaults.for_bot(bot_id);
        let sandbox_size = self.sessions.user_sandbox_size(&origin.sender).await?;

        // Provisioned before the session exists, because the row is what makes
        // the token mean anything: it carries the hash the proxy recognises.
        // Minted here, where the session's owner is in hand, and only here -
        // the token is scoped to this session and spends this person's
        // credentials, so there is nowhere else it could correctly come from.
        let egress = self
            .egress
            .provision(session_id, &origin.sender, &runtime.mcp_servers)
            .await?;

        let session = self
            .sessions
            .create_session(CreateAgentSessionParams {
                repo_branch: None,
                id: session_id,
                owner_id: origin.sender.clone(),
                bot_id,
                thread_id: Some(origin.thread_id),
                originating_message_id: Some(origin.message_id),
                model: runtime.model.clone(),
                harness: runtime.harness.clone(),
                repo_url: defaults
                    .repo_url
                    .as_ref()
                    .map(|repo| repo.as_str().to_owned()),
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
                action: AgentAction::prompt_with_attachments(origin.content, origin.attachments),
                actor: Some(origin.sender),
                announce: Some(AnnounceOrigin {
                    parent: origin.parent,
                    thread_id: origin.thread_id,
                    message_id: origin.message_id,
                }),
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
