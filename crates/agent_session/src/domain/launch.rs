//! Session creation shared by interactive clients and delegated tasks.

use bot_id::BotId;
use model_owner::Owner;

use super::error::AgentSessionError;
use super::model::{
    AgentMcpServer, AgentMcpServers, AgentSession, AgentSessionId, SessionSource, SessionVisibility,
};
use super::ports::{
    BotDirectory, ExternalSessionRequester, FirstPrompt, ManagedPersonaError, OpenManagedSession,
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
    pub prompt: Option<FirstPrompt>,
    /// Instructions for a session without a saved persona.
    pub instructions: Option<String>,
    /// Explicit model override.
    pub model: Option<String>,
    /// Repository selected through the same validation as the UI.
    pub repo_url: Option<String>,
    /// Optional starting branch.
    pub repo_branch: Option<String>,
    /// Who is starting the session.
    pub source: SessionSource,
    /// Whether a routine run is listed; a person's session always is.
    pub visibility: SessionVisibility,
    /// Connected apps a routine requires; added to a persona limited to selected apps.
    pub required_apps: Vec<AgentMcpServer>,
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
        Some(SelectedPersona::Managed(mut profile)) => {
            if let Some(managed) = &mut profile.profile {
                add_routine_apps(&mut managed.mcp_servers, &request.required_apps);
            }
            Some(profile)
        }
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
                    source: request.source,
                    visibility: request.visibility,
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
            source: request.source,
            visibility: request.visibility,
            prompt: request.prompt,
            instructions: request.instructions.filter(|text| !text.trim().is_empty()),
            repo_url: request.repo_url,
            repo_branch,
        })
        .await
        .map_err(LaunchSessionError::Session)
}

/// An agent limited to selected apps also gets the routine's. One that uses
/// every app its runner connected already has them: they are required to be
/// connected.
fn add_routine_apps(servers: &mut AgentMcpServers, required: &[AgentMcpServer]) {
    if let AgentMcpServers::Selected { servers } = servers {
        for app in required {
            if !servers.iter().any(|server| server.app_slug == app.app_slug) {
                servers.push(app.clone());
            }
        }
    }
}
