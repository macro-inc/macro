//! Session creation shared by interactive clients and delegated tasks.

use bot_id::BotId;
use model_owner::Owner;

use super::error::AgentSessionError;
use super::model::{AgentSession, AgentSessionId};
use super::ports::{
    BotDirectory, ExternalSessionRequester, ManagedPersonaError, OpenManagedSession,
    RequestedExternalSession, SelectedPersona, SessionOpener, external_repository,
    persona_for_owner,
};
use super::repository_branch::RepositoryBranch;

/// User-selected options, independent of the transport that starts the session.
pub struct LaunchSession {
    /// Optional caller-allocated identity.
    pub id: Option<AgentSessionId>,
    /// Verified owner whose credentials and permissions the session uses.
    pub owner: Owner,
    /// Saved or system persona; absent selects the default in-memory agent.
    pub bot_id: Option<BotId>,
    /// Optional initial prompt for managed runtimes.
    pub prompt: Option<String>,
    /// Instructions for a session without a saved persona.
    pub instructions: Option<String>,
    /// Explicit model override.
    pub model: Option<String>,
    /// Repository selected through the same validation as the UI.
    pub repo_url: Option<String>,
    /// Optional starting branch.
    pub repo_branch: Option<String>,
}

/// Creation failures retain the persona policy's distinctions for adapters.
#[derive(Debug)]
pub enum LaunchSessionError {
    /// Persona authorization or resolution failed.
    Persona(ManagedPersonaError),
    /// External runtimes receive their first prompt through session controls.
    ExternalPrompt,
    /// Session provisioning failed.
    Session(AgentSessionError),
}

impl From<AgentSessionError> for LaunchSessionError {
    fn from(error: AgentSessionError) -> Self {
        Self::Session(error)
    }
}

/// Authorize the selected persona and open it on its configured runtime.
pub async fn launch_session(
    bots: &impl BotDirectory,
    opener: &impl SessionOpener,
    external: &impl ExternalSessionRequester,
    request: LaunchSession,
) -> Result<AgentSession, LaunchSessionError> {
    let selected = match request.bot_id {
        Some(bot_id) => Some(
            persona_for_owner(bots, bot_id, &request.owner)
                .await
                .map_err(LaunchSessionError::Persona)?,
        ),
        None => None,
    };
    let model = request.model.filter(|model| !model.trim().is_empty());
    let profile = match selected {
        Some(SelectedPersona::Managed(profile)) => Some(profile),
        Some(SelectedPersona::External { bot_id }) => {
            let repo_url = external_repository(request.repo_url, request.repo_branch.as_deref())?;
            if request.prompt.is_some() {
                return Err(LaunchSessionError::ExternalPrompt);
            }
            let owner = super::model::session_owner_user(&request.owner)?.clone();
            return external
                .request(RequestedExternalSession {
                    session_id: request.id.unwrap_or_else(AgentSessionId::new),
                    bot_id,
                    owner,
                    repo_url,
                    model,
                })
                .await
                .map_err(LaunchSessionError::Session);
        }
        None => None,
    };
    let repo_branch = request
        .repo_branch
        .map(RepositoryBranch::parse)
        .transpose()
        .map_err(AgentSessionError::InvalidRepositorySelection)?;
    opener
        .open_managed_session(OpenManagedSession {
            id: request.id,
            owner: request.owner,
            profile,
            model,
            prompt: request.prompt,
            instructions: request.instructions.filter(|text| !text.trim().is_empty()),
            repo_url: request.repo_url,
            repo_branch,
        })
        .await
        .map_err(LaunchSessionError::Session)
}
