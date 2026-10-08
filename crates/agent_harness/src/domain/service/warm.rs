//! Speculative in-memory sessions. No model or tool is invoked during warming.
use super::open::starting_branch;
use super::*;
use crate::domain::model::SessionRepository;
use agent_session::domain::model::session_owner_user;
use agent_session::domain::ports::{OpenManagedSession, SelectedManagedPersona};
use model_owner::Owner;
use std::time::{Duration, Instant};

const WARM_RESERVATION_TTL: Duration = Duration::from_secs(600);
const WARM_PREPARATION_TIMEOUT: Duration = Duration::from_secs(30);
const ACP_READY_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_WARM_RESERVATIONS: usize = 64;
const MAX_WARM_RESERVATIONS_PER_OWNER: usize = 2;

pub(super) type WarmReservations = std::collections::HashMap<AgentSessionId, (Owner, Instant)>;

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
    AgentHarnessService<
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
    #[tracing::instrument(skip_all, err, fields(agent.session.id = tracing::field::Empty, agent.harness = tracing::field::Empty, agent.session.warm = warm, agent.session.warm_hit = false))]
    pub(super) async fn open_managed_session_inner(
        &self,
        request: agent_session::domain::ports::OpenManagedSession,
        warm: bool,
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
        // A caller's pick outranks the persona's: choosing a model on the way
        // in is choosing what this session runs on, for its whole life.
        let requested_model = request.model;
        let model = requested_model.clone().unwrap_or(model);
        let kind = AgentKind::for_session(bot_id, &harness);
        let harness = kind.harness_slug().map_or(harness, str::to_owned);
        tracing::Span::current().record("agent.harness", &harness);
        if kind == AgentKind::CodexCloud {
            mcp_servers = AgentMcpServers::Selected {
                servers: Vec::new(),
            };
        }
        let owner_user = session_owner_user(&request.owner)?;
        let session_id = request.id.unwrap_or_else(AgentSessionId::new);
        tracing::Span::current().record("agent.session.id", tracing::field::display(session_id));
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
                .for_user(&owner_user)
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
        self.inner
            .admit_open(bot_id, &harness, &owner_user)
            .instrument(tracing::info_span!("agent.init.admission", agent.session.id = %session_id))
            .await
            .map_err(into_session_error)?;
        if !warm
            && kind == AgentKind::InMemory
            && bot_id == bot_id::MACRO_NEW_BOT_ID
            && matches!(mcp_servers, AgentMcpServers::OwnerConnections)
            && request.repo_url.is_none()
            && let Some(lifecycle) = &self.warm_lifecycle
            && lifecycle
                .claim(
                    session_id,
                    &request.owner,
                    bot_id,
                    &model,
                    instructions.as_deref(),
                )
                .await?
        {
            self.warm_reservations.lock().await.remove(&session_id);
            tracing::Span::current().record("agent.session.warm_hit", true);
            let session = self.inner.sessions.get_session(session_id).await?;
            self.inner
                .publish_opened(&session)
                .instrument(
                    tracing::info_span!("agent.init.publish", agent.session.id = %session_id),
                )
                .await;
            if let Some(prompt) = request.prompt {
                let (id, action) = prompt.into_action();
                self.execute(
                    session_id,
                    HarnessCommand::Deliver(DeliverAction {
                        id,
                        action,
                        actor: Some(owner_user),
                        announce: None,
                    }),
                )
                .await
                .map_err(into_session_error)?;
            }
            return Ok(session);
        }
        let defaults = self.inner.defaults.for_bot(bot_id);
        let sandbox_size = self
            .inner
            .sessions
            .user_sandbox_size(&owner_user)
            .instrument(
                tracing::info_span!("agent.init.preferences", agent.session.id = %session_id),
            )
            .await?;
        // Same ordering as the trigger path's open: the token has to be minted
        // before the row, because the row is what carries the hash that makes
        // it mean anything.
        let egress = self
            .inner
            .egress
            .provision(session_id, &owner_user, &mcp_servers)
            .instrument(tracing::info_span!("agent.init.egress", agent.session.id = %session_id))
            .await
            .map_err(into_session_error)?;
        let session = self
            .inner
            .sessions
            .create_session(CreateAgentSessionParams {
                warm,
                repo_branch: selected_repo.as_ref().map(|(_, branch)| branch.clone()),
                id: session_id,
                owner_id: request.owner,
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
            .instrument(tracing::info_span!("agent.init.persist", agent.session.id = %session_id))
            .await?;
        if !warm {
            self.inner
                .publish_opened(&session)
                .instrument(
                    tracing::info_span!("agent.init.publish", agent.session.id = %session_id),
                )
                .await;
        }

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
            .instrument(tracing::info_span!("agent.init.runtime", agent.session.id = %session_id))
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
        let permission_policy = self
            .inner
            .permission_policy_for(session.bot_id)
            .instrument(
                tracing::info_span!("agent.init.permissions", agent.session.id = %session_id),
            )
            .await;
        let attachment = container
            .mcp_servers(mcp_servers.clone())
            .permission_policy(permission_policy);
        let attachment = match requested_model {
            Some(model) if !kind.starts_on_session_model() => attachment.initial_model(model),
            _ => attachment,
        };
        self.inner
            .sessions
            .attach_session(session.id, attachment)
            .instrument(tracing::info_span!("agent.init.attach", agent.session.id = %session_id))
            .await?;

        if warm {
            // Ordinary session/new returns while MCP initializes in the background.
            // Speculation is only ready after the same shared connector pool has
            // finished listing and the runtime has answered its handshake.
            self.warm_tools.tool_definitions(mcp_servers).await;
            while self
                .inner
                .sessions
                .get_session(session.id)
                .await?
                .acp_session_id
                .is_none()
            {
                tokio::time::sleep(ACP_READY_POLL_INTERVAL).await;
            }
        }

        // Raw, through the session's own command worker: dispatch is where a
        // prompt is composed, and the worker is what serializes this first
        // prompt against any control prompt racing the session's birth.
        if let Some(prompt) = request.prompt {
            let (id, action) = prompt.into_action();
            self.execute_here(
                session.id,
                HarnessCommand::Deliver(DeliverAction {
                    id,
                    action,
                    actor: Some(owner_user),
                    announce: None,
                }),
            )
            .await
            .map_err(into_session_error)?;
        }

        Ok(session)
    }

    /// Configure the owning session domain's atomic claim and expiry port.
    pub fn with_warm_sessions(
        mut self,
        lifecycle: Arc<dyn agent_session::domain::warm::WarmSessionLifecycle>,
        tools: Arc<dyn agent_session::domain::ports::SessionToolCatalog>,
    ) -> Self {
        self.warm_lifecycle = Some(lifecycle);
        self.warm_tools = tools;
        self
    }

    pub(super) async fn prepare_warm(
        &self,
        owner: Owner,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<Option<AgentSession>> {
        session_owner_user(&owner)?;
        if self.warm_lifecycle.is_none() {
            return Ok(None);
        }
        {
            let mut reservations = self.warm_reservations.lock().await;
            reservations.retain(|_, (_, started)| started.elapsed() < WARM_RESERVATION_TTL);
            if reservations.contains_key(&id) {
                return Ok(None);
            }
            if reservations.len() >= MAX_WARM_RESERVATIONS
                || reservations
                    .values()
                    .filter(|(user, _)| user == &owner)
                    .count()
                    >= MAX_WARM_RESERVATIONS_PER_OWNER
            {
                return Ok(None);
            }
            reservations.insert(id, (owner.clone(), Instant::now()));
        }
        let request = OpenManagedSession {
            id: Some(id),
            owner,
            prompt: None,
            repo_url: None,
            repo_branch: None,
            profile: Some(SelectedManagedPersona {
                bot_id: bot_id::MACRO_NEW_BOT_ID,
                profile: None,
            }),
            instructions: None,
            model: None,
        };
        match tokio::time::timeout(
            WARM_PREPARATION_TIMEOUT,
            self.open_managed_session_inner(request, true),
        )
        .await
        {
            Ok(Ok(session)) => Ok(Some(session)),
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, "warm session preparation failed");
                Ok(None)
            }
            Err(_) => {
                tracing::warn!("warm session preparation timed out");
                Ok(None)
            }
        }
    }

    /// Periodic bounded cleanup, including reservations left by a previous process.
    pub async fn reap_warm_sessions(&self) {
        let Some(lifecycle) = &self.warm_lifecycle else {
            return;
        };
        match lifecycle.expire().await {
            Ok(ids) => {
                for id in ids {
                    self.warm_reservations.lock().await.remove(&id);
                    if let Err(error) = self.execute(id, HarnessCommand::Delete).await {
                        tracing::warn!(error = ?error, session_id = %id, "warm session cleanup failed");
                    }
                }
            }
            Err(error) => tracing::warn!(error = ?error, "warm session expiry failed"),
        }
    }
}
