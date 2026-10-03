//! Executes trigger work against the live service: create, dial, prompt.

use agent_session::domain::model::AgentSessionId;
use agent_session::inbound::axum_router::{CreateAgentSessionRequest, CreateSessionThread};

use macro_user_id::user_id::MacroUserIdStr;

use crate::config::Workspace;
use crate::outbound::agent_session::{ApiError, HarnessApi};
use crate::runtime::Runtime;
use crate::trigger::{TriggerWork, WorkExecutor};

/// A failure doing an event's work.
#[derive(Debug, thiserror::Error)]
pub enum DispatchError {
    /// The repository or Herdr worktree could not be prepared.
    #[error("workspace preparation failed: {0}")]
    Workspace(String),
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
    runtime: Runtime,
    workspace: Workspace,
    #[cfg(unix)]
    workspaces: Option<crate::herdr::repositories::Workspaces>,
    #[cfg(unix)]
    herdr: Option<crate::herdr::Hub>,
}

impl Dispatcher {
    /// Build the executor.
    pub fn new(api: HarnessApi, runtime: Runtime, workspace: Workspace) -> Self {
        Self {
            api,
            runtime,
            workspace,
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

    async fn workspace_for(
        &self,
        session: AgentSessionId,
        repo_url: Option<&str>,
    ) -> Result<String, DispatchError> {
        #[cfg(unix)]
        if let Some(workspaces) = &self.workspaces {
            let inferred;
            let url = match repo_url.or(self.workspace.repo_url.as_deref()) {
                Some(url) => url,
                None => {
                    inferred = crate::outbound::git::git(
                        &self.workspace.path,
                        &["remote", "get-url", "origin"],
                    )
                    .await
                    .map_err(|error| {
                        DispatchError::Workspace(format!("select a repository in Macro: {error}"))
                    })?;
                    &inferred
                }
            };
            return workspaces
                .prepare(&session.to_string(), url)
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
        Ok(self.workspace.path.to_string_lossy().into_owned())
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
            } => {
                let session = AgentSessionId::new_from_uuid(uuid::Uuid::new_v5(
                    &bot.as_uuid(),
                    thread_id.as_bytes(),
                ));
                let workspace = self.workspace_for(session, None).await?;
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
                        self.api.prompt(session, &sender, &content).await?;
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
                self.api.prompt(session, &sender, &content).await?;
                Ok(())
            }
            TriggerWork::OpenRequested {
                repo_url,
                session,
                bot,
                sender,
            } => {
                let workspace = self.workspace_for(session, repo_url.as_deref()).await?;
                // Same create as a mention, minus the thread: the requester is
                // waiting on this id, so the session is created under it. No
                // prompt here - whoever asked sends their own through the
                // session once this create answers them.
                let request = CreateAgentSessionRequest {
                    id: Some(session.as_uuid()),
                    bot_id: Some(bot.as_uuid()),
                    workspace: Some(workspace),
                    prompt: None,
                    repo_url: repo_url.or_else(|| self.workspace.repo_url.clone()),
                    repo_branch: None,
                    owner: Some(sender.as_ref().to_owned()),
                    thread: None,
                    instructions: None,
                    model: None,
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
                session,
                sender,
                content,
            } => {
                self.prompted(session, &sender);
                self.runtime
                    .ensure_connected()
                    .await
                    .map_err(DispatchError::Dial)?;
                self.api.prompt(session, &sender, &content).await?;
                Ok(())
            }
        }
    }
}
