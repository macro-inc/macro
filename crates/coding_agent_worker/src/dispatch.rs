//! Executes trigger work against the live service: create, dial, prompt.

use agent_session::domain::model::AgentSessionId;
use agent_session::inbound::axum_router::{CreateAgentSessionRequest, CreateSessionThread};

use crate::config::Workspace;
use crate::outbound::agent_session::{ApiError, HarnessApi};
use crate::runtime::Runtime;
use crate::webhook::{TriggerWork, WorkExecutor};

/// A failure doing an event's work.
#[derive(Debug, thiserror::Error)]
pub enum DispatchError {
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
}

impl Dispatcher {
    /// Build the executor.
    pub fn new(api: HarnessApi, runtime: Runtime, workspace: Workspace) -> Self {
        Self {
            api,
            runtime,
            workspace,
        }
    }
}

impl WorkExecutor for Dispatcher {
    async fn execute(&self, work: TriggerWork) -> Result<(), DispatchError> {
        match work {
            TriggerWork::OpenAndPrompt {
                sender,
                channel_id,
                thread_id,
                message_id,
                content,
            } => {
                let request = CreateAgentSessionRequest {
                    // The bot is the one whose credentials this daemon holds,
                    // and naming another one is refused anyway.
                    bot_id: None,
                    workspace: Some(self.workspace.path.to_string_lossy().into_owned()),
                    // External sessions carry no first prompt: this daemon is
                    // the runtime, and it delivers the mention itself through
                    // the control endpoint. Sending one here is refused.
                    prompt: None,
                    repo_url: self.workspace.repo_url.clone(),
                    owner: Some(sender.as_ref().to_owned()),
                    thread: Some(CreateSessionThread {
                        channel_id,
                        thread_id: Some(thread_id),
                        message_id,
                        content: content.clone(),
                    }),
                    // This daemon is the harness: its system prompt is
                    // whatever the binary in its config was built with, so
                    // there is nothing to state here.
                    instructions: None,
                };
                let created = match self.api.create_session(&request).await {
                    Ok(created) => created,
                    // A redelivered mention: the thread's session exists.
                    // Resume serving it - the first attempt may have died
                    // between create and prompt, and re-prompting a session
                    // that already heard the mention is the cheaper failure.
                    Err(ApiError::ThreadSessionExists {
                        session: Some(session),
                    }) => {
                        tracing::info!(%thread_id, %session, "thread already has a session; resuming it");
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
                self.runtime
                    .ensure_connected()
                    .await
                    .map_err(DispatchError::Dial)?;
                // No retry around the prompt: the session actor buffers
                // actions from the moment the runtime attaches, so the only
                // uncovered window is the sub-millisecond gap between the
                // websocket's 101 and the server's `on_upgrade` attach. If
                // that race ever bites, failing the delivery is the right
                // answer - webhook redelivery re-runs this arm, and a repeat
                // create answers 409 with the session id, which the branch
                // above resumes.
                self.api.prompt(session, &sender, &content).await?;
                Ok(())
            }
            TriggerWork::PromptExisting {
                session,
                sender,
                content,
            } => {
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
