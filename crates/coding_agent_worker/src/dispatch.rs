//! Executes trigger work against the live service: create, dial, prompt.

use std::path::PathBuf;

use agent_session::domain::model::AgentSessionId;
use agent_session::inbound::axum_router::{CreateAgentSessionRequest, CreateSessionThread};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use crate::config::Workspace;
use crate::outbound::agent_session::{ApiError, HarnessApi};
use crate::outbound::stream::EventStreamClient;
use crate::runtime::Runtime;
use crate::trigger::{TriggerWork, WorkExecutor};
use crate::workspace::{AllowedRoots, requested_workspace};

/// A failure doing an event's work.
#[derive(Debug, thiserror::Error)]
pub enum DispatchError {
    /// The workspace was refused, or its repository or Herdr worktree could
    /// not be prepared.
    #[error("workspace preparation failed: {0}")]
    Workspace(String),
    /// The workspace Macro set for the runtime or agent could not be read.
    #[error("could not read the workspace set in Macro: {0}")]
    Settings(rootcause::Report),
    /// The service refused or could not be reached.
    #[error(transparent)]
    Api(#[from] ApiError),
    /// The session's gateway could not be dialed.
    #[error("failed to dial the runtime gateway")]
    Dial(#[source] tokio_tungstenite::tungstenite::Error),
}

/// The daemon's real executor: the API client plus the bridge registry.
pub struct Dispatcher {
    api: HarnessApi,
    settings: EventStreamClient,
    runtime: Runtime,
    workspace: Workspace,
    allowed_roots: AllowedRoots,
    #[cfg(unix)]
    workspaces: Option<crate::herdr::repositories::Workspaces>,
    #[cfg(unix)]
    herdr: Option<crate::herdr::Hub>,
}

impl Dispatcher {
    /// Build the executor. `settings` reads the workspaces Macro set for the
    /// runtime and its agents.
    pub fn new(
        api: HarnessApi,
        settings: EventStreamClient,
        runtime: Runtime,
        workspace: Workspace,
        allowed_roots: AllowedRoots,
    ) -> Self {
        Self {
            api,
            settings,
            runtime,
            workspace,
            allowed_roots,
            #[cfg(unix)]
            workspaces: None,
            #[cfg(unix)]
            herdr: None,
        }
    }

    /// Tell `hub` about every session this dispatcher opens or prompts, so
    /// its herdr windows can steer them as the right user.
    #[cfg(unix)]
    #[must_use]
    pub fn with_herdr(mut self, hub: crate::herdr::Hub) -> Self {
        self.herdr = Some(hub);
        self
    }

    /// Configure Herdr-managed repository preparation for this daemon.
    #[cfg(unix)]
    pub fn with_workspaces(
        mut self,
        workspaces: Option<crate::herdr::repositories::Workspaces>,
    ) -> Self {
        self.workspaces = workspaces;
        self
    }

    /// The directory a new session for `bot` works in: the agent's workspace,
    /// else the runtime's, else the local one, read fresh from Macro so a
    /// change on the web applies to the next session. Refused outside
    /// `allowed_roots`.
    #[tracing::instrument(
        name = "macrod.workspace.resolve",
        skip(self),
        fields(source = tracing::field::Empty, workspace = tracing::field::Empty),
        err
    )]
    async fn resolve_workspace(
        &self,
        session: AgentSessionId,
        bot: BotId,
    ) -> Result<PathBuf, DispatchError> {
        let (agents, harness) = self
            .settings
            .workspace_settings()
            .await
            .map_err(DispatchError::Settings)?;
        let agent_workspace = agents
            .into_iter()
            .find(|agent| agent.bot_id == bot)
            .and_then(|agent| agent.workspace_path);
        let (requested, source) = requested_workspace(
            agent_workspace.as_deref(),
            harness.workspace_path.as_deref(),
            &self.workspace.path,
        );

        let span = tracing::Span::current();
        span.record("source", <&str>::from(source));
        let admitted = self.allowed_roots.admit(&requested).map_err(|refusal| {
            tracing::warn!(
                %session,
                %bot,
                source = <&str>::from(source),
                workspace = %requested.display(),
                reason = %refusal,
                "refused a session workspace"
            );
            DispatchError::Workspace(refusal.to_string())
        })?;
        span.record("workspace", tracing::field::display(admitted.display()));
        Ok(admitted)
    }

    async fn workspace_for(
        &self,
        session: AgentSessionId,
        bot: BotId,
        repo_url: Option<&str>,
    ) -> Result<String, DispatchError> {
        let workspace = self.resolve_workspace(session, bot).await?;
        #[cfg(unix)]
        if let Some(workspaces) = &self.workspaces {
            let inferred;
            let url = match repo_url.or(self.workspace.repo_url.as_deref()) {
                Some(url) => url,
                None => {
                    inferred =
                        crate::outbound::git::git(&workspace, &["remote", "get-url", "origin"])
                            .await
                            .map_err(|error| {
                                DispatchError::Workspace(format!(
                                    "select a repository in Macro: {error}"
                                ))
                            })?;
                    &inferred
                }
            };
            return workspaces
                .prepare(&workspace, &session.to_string(), url)
                .await
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| DispatchError::Workspace(error.to_string()));
        }
        if repo_url.is_some() && repo_url != self.workspace.repo_url.as_deref() {
            return Err(DispatchError::Workspace(
                "this runtime does not manage repositories; choose a Herdr agent in macrod"
                    .to_owned(),
            ));
        }
        Ok(workspace.to_string_lossy().into_owned())
    }

    fn created(&self, session: AgentSessionId, sender: &MacroUserIdStr<'static>) {
        #[cfg(unix)]
        if let Some(hub) = &self.herdr {
            hub.session_created(session, sender.clone());
        }
        #[cfg(not(unix))]
        let _ = (session, sender);
    }

    fn prompted(&self, session: AgentSessionId, sender: &MacroUserIdStr<'static>) {
        #[cfg(unix)]
        if let Some(hub) = &self.herdr {
            hub.owner_seen(session, sender.clone());
        }
        #[cfg(not(unix))]
        let _ = (session, sender);
    }
}

impl WorkExecutor for Dispatcher {
    async fn execute(&self, work: TriggerWork) -> Result<(), DispatchError> {
        match work {
            TriggerWork::OpenAndPrompt {
                reuse_origin_message,
                bot,
                sender,
                parent,
                thread_id,
                message_id,
                content,
                context,
                origin,
            } => {
                let session = AgentSessionId::new_from_uuid(uuid::Uuid::new_v5(
                    &bot.as_uuid(),
                    thread_id.as_bytes(),
                ));
                let workspace = self.workspace_for(session, bot, None).await?;
                let request = CreateAgentSessionRequest {
                    // The service mints the id: nothing here opens a surface
                    // on it before the create answers.
                    id: Some(session.as_uuid()),
                    // A harness serves many agents, so the token implies no
                    // bot: name the mentioned agent, and the service verifies
                    // it is bound to this harness.
                    bot_id: Some(bot.as_uuid()),
                    workspace: Some(workspace),
                    // External sessions carry no first prompt: this daemon is
                    // the runtime, and it delivers the mention itself through
                    // the control endpoint. Sending one here is refused.
                    prompt: None,
                    prompt_action_id: None,
                    prompt_attachments: Vec::new(),
                    repo_url: self.workspace.repo_url.clone(),
                    repo_branch: None,
                    owner: Some(sender.as_ref().to_owned()),
                    thread: Some(CreateSessionThread {
                        reuse_origin_message,
                        // Keep `channel_id` populated for channel parents so a
                        // pre-parent harness, which ignores `parent` and reads
                        // `channel_id` as a required UUID, still deserializes
                        // the request. Document parents have no channel id.
                        channel_id: match &parent {
                            messages::domain::models::MessageParent::Channel(channel_id) => {
                                Some(*channel_id)
                            }
                            messages::domain::models::MessageParent::Document(_)
                            | messages::domain::models::MessageParent::Call(_)
                            | messages::domain::models::MessageParent::Initiative(_)
                            | messages::domain::models::MessageParent::CrmCompany(_)
                            | messages::domain::models::MessageParent::CrmContact(_) => None,
                        },
                        parent: Some(parent),
                        thread_id: Some(thread_id),
                        message_id,
                        content: content.clone(),
                    }),
                    // This daemon is the harness: its system prompt is
                    // whatever the binary in its config was built with, so
                    // there is nothing to state here.
                    instructions: None,
                    // Likewise the model: an external session runs on
                    // whatever this runtime is configured with.
                    model: None,
                    origin: *origin,
                };
                let created = match self.api.create_session(&request, &sender).await {
                    Ok(created) => created,
                    // A redelivered mention: the thread's session exists.
                    // Resume serving it - the first attempt may have died
                    // between create and prompt, and re-prompting a session
                    // that already heard the mention is the cheaper failure.
                    Err(ApiError::ThreadSessionExists {
                        session: Some(session),
                    }) => {
                        tracing::info!(%thread_id, %session, "thread already has a session; resuming it");
                        self.prompted(session, &sender);
                        self.runtime
                            .ensure_connected()
                            .await
                            .map_err(DispatchError::Dial)?;
                        self.api
                            .prompt(session, &sender, &content, message_id, context)
                            .await?;
                        return Ok(());
                    }
                    Err(ApiError::ThreadSessionExists { session: None }) => {
                        tracing::warn!(%thread_id, "thread has a session the service could not name; acked");
                        return Ok(());
                    }
                    Err(error) => return Err(error.into()),
                };
                let session = AgentSessionId::new_from_uuid(created.session.id);
                self.created(session, &sender);
                self.runtime
                    .ensure_connected()
                    .await
                    .map_err(DispatchError::Dial)?;
                // No retry around the prompt: the session actor buffers
                // actions from the moment the runtime attaches, so the only
                // uncovered window is the sub-millisecond gap between the
                // websocket's 101 and the server's `on_upgrade` attach. If
                // that race ever bites, failing the delivery is the right
                // answer. SSE has no redelivery; a later `agent_trigger.existing`
                // or a 409 on a repeat create (session already exists) is how
                // a follow-up lands on the same session.
                self.api
                    .prompt(session, &sender, &content, message_id, context)
                    .await?;
                Ok(())
            }
            TriggerWork::OpenRequested {
                repo_url,
                session,
                bot,
                sender,
                origin,
            } => {
                let workspace = self
                    .workspace_for(session, bot, repo_url.as_deref())
                    .await?;
                // Same create as a mention, minus the thread: the requester is
                // waiting on this id, so the session is created under it. No
                // prompt here - whoever asked sends their own through the
                // session once this create answers them.
                let request = CreateAgentSessionRequest {
                    id: Some(session.as_uuid()),
                    bot_id: Some(bot.as_uuid()),
                    workspace: Some(workspace),
                    prompt: None,
                    prompt_action_id: None,
                    prompt_attachments: Vec::new(),
                    repo_url: repo_url.or_else(|| self.workspace.repo_url.clone()),
                    repo_branch: None,
                    owner: Some(sender.as_ref().to_owned()),
                    thread: None,
                    instructions: None,
                    model: None,
                    origin,
                };
                self.api.create_session(&request, &sender).await?;
                self.created(session, &sender);
                // Be dialed in before the prompt the requester is about to
                // send arrives, so it lands on a runtime that is serving.
                self.runtime
                    .ensure_connected()
                    .await
                    .map_err(DispatchError::Dial)?;
                Ok(())
            }
            TriggerWork::PromptExisting {
                message_id,
                session,
                sender,
                content,
                context,
            } => {
                self.prompted(session, &sender);
                self.runtime
                    .ensure_connected()
                    .await
                    .map_err(DispatchError::Dial)?;
                self.api
                    .prompt(session, &sender, &content, message_id, context)
                    .await?;
                Ok(())
            }
        }
    }
}
