use agent_fold::domain::lifecycle::LifecycleFold;
use agent_fold::domain::model::Author;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use model_owner::Owner;

use super::status::action_status;
use super::{
    ConnectedApps, NoRoutineTools, RoutineSessions, RoutineToolRunner, RoutineTools, models::*,
};
use crate::domain::error::AgentSessionError;
use crate::domain::model::{AgentMcpServer, AgentMcpServers, AgentSession, AgentSessionId};
use crate::domain::ports::{
    AgentSessionNotificationRecipient, BotDirectory, ControlDisposition, ControlEvent,
    ExternalSessionRequester, ManagedPersonaError, OpenManagedSession, RequestedExternalSession,
    SelectedPersona, SessionOpener, persona_for_owner,
};
use crate::domain::service::AgentSessionService;

/// Longest catalog tool name a routine may call.
const MAX_TOOL_NAME_CHARS: usize = 64;

/// Domain orchestration using the same provisioning and controls as interactive sessions.
#[derive(Clone)]
pub struct RoutineSessionsService<
    Bots,
    Opener,
    External,
    Sessions,
    Controls,
    Apps,
    Tools = NoRoutineTools,
> {
    bots: Bots,
    opener: Opener,
    external: External,
    sessions: Sessions,
    controls: Controls,
    apps: Apps,
    tools: Tools,
}

impl<Bots, Opener, External, Sessions, Controls, Apps>
    RoutineSessionsService<Bots, Opener, External, Sessions, Controls, Apps>
{
    /// Compose existing capabilities; no new runtime or persistence implementation.
    /// Tool calls stay unavailable until [`Self::with_tools`].
    pub fn new(
        bots: Bots,
        opener: Opener,
        external: External,
        sessions: Sessions,
        controls: Controls,
        apps: Apps,
    ) -> Self {
        Self {
            bots,
            opener,
            external,
            sessions,
            controls,
            apps,
            tools: NoRoutineTools,
        }
    }
}

impl<Bots, Opener, External, Sessions, Controls, Apps, Tools>
    RoutineSessionsService<Bots, Opener, External, Sessions, Controls, Apps, Tools>
{
    /// Run routine tool steps through `tools`.
    pub fn with_tools<T: RoutineToolRunner>(
        self,
        tools: T,
    ) -> RoutineSessionsService<Bots, Opener, External, Sessions, Controls, Apps, T> {
        RoutineSessionsService {
            bots: self.bots,
            opener: self.opener,
            external: self.external,
            sessions: self.sessions,
            controls: self.controls,
            apps: self.apps,
            tools,
        }
    }
}

impl<Bots, Opener, External, Sessions, Controls, Apps, Tools> RoutineTools
    for RoutineSessionsService<Bots, Opener, External, Sessions, Controls, Apps, Tools>
where
    Bots: Send + Sync + 'static,
    Opener: Send + Sync + 'static,
    External: Send + Sync + 'static,
    Sessions: Send + Sync + 'static,
    Controls: Send + Sync + 'static,
    Apps: Send + Sync + 'static,
    Tools: RoutineToolRunner,
{
    async fn call_tool(
        &self,
        command: CallRoutineTool,
    ) -> Result<RoutineToolOutcome, RoutineSessionError> {
        let tool = command.tool.trim();
        if tool.is_empty() || tool.chars().count() > MAX_TOOL_NAME_CHARS {
            return Err(RoutineSessionError::InvalidCommand);
        }
        self.tools
            .run(&command.owner, tool, command.arguments)
            .await
    }
}

impl<Bots, Opener, External, Sessions, Controls, Apps, Tools>
    RoutineSessionsService<Bots, Opener, External, Sessions, Controls, Apps, Tools>
where
    Bots: BotDirectory,
    Sessions: AgentSessionService,
    Apps: ConnectedApps,
{
    async fn select(
        &self,
        selection: &ValidateRoutineSession,
    ) -> Result<SelectedPersona, RoutineSessionError> {
        if selection
            .model
            .as_ref()
            .is_some_and(|model| model.trim().is_empty())
        {
            return Err(RoutineSessionError::InvalidCommand);
        }
        let persona = persona_for_owner(
            &self.bots,
            selection.bot_id,
            &Owner::User(selection.owner.clone()),
        )
        .await
        .map_err(|error| match error {
            ManagedPersonaError::Forbidden | ManagedPersonaError::OwnerNotUser(_) => {
                RoutineSessionError::Forbidden
            }
            ManagedPersonaError::Lookup(error) => session_error(error),
            ManagedPersonaError::Unknown
            | ManagedPersonaError::NotAgent
            | ManagedPersonaError::UnmanagedSystemBot => RoutineSessionError::PersonaUnavailable,
        })?;
        self.require_apps(selection, &persona).await?;
        Ok(persona)
    }

    /// Checked on save and again before every run, so an app disconnected
    /// since fails the run instead of leaving the agent without it.
    async fn require_apps(
        &self,
        selection: &ValidateRoutineSession,
        persona: &SelectedPersona,
    ) -> Result<(), RoutineSessionError> {
        if selection.mcp_servers.is_empty() {
            return Ok(());
        }
        if matches!(persona, SelectedPersona::External { .. }) {
            return Err(RoutineSessionError::AppsUnsupported);
        }
        let connected = self
            .apps
            .connected_app_slugs(&selection.owner)
            .await
            .map_err(|error| {
                tracing::warn!(error = ?error, "could not list a routine owner's connected apps");
                RoutineSessionError::OperationFailed
            })?;
        if selection
            .mcp_servers
            .iter()
            .all(|server| connected.contains(&server.app_slug))
        {
            Ok(())
        } else {
            Err(RoutineSessionError::AppNotConnected)
        }
    }

    async fn owned_session(
        &self,
        action: &RoutineSessionAction,
    ) -> Result<AgentSession, RoutineSessionError> {
        validate_session_id(action.session_id)?;
        if action.action_id.as_uuid().get_version_num() != 7 {
            return Err(RoutineSessionError::InvalidCommand);
        }
        let session = self
            .sessions
            .get_session(action.session_id)
            .await
            .map_err(session_error)?;
        if session.id != action.session_id
            || session.bot_id != action.bot_id
            || session.owner_id != Owner::User(action.owner.clone())
        {
            return Err(RoutineSessionError::Forbidden);
        }
        Ok(session)
    }
}

impl<Bots, Opener, External, Sessions, Controls, Apps, Tools> RoutineSessions
    for RoutineSessionsService<Bots, Opener, External, Sessions, Controls, Apps, Tools>
where
    Bots: BotDirectory,
    Opener: SessionOpener,
    External: ExternalSessionRequester,
    Sessions: AgentSessionService,
    Controls: AgentSessionNotificationRecipient,
    Apps: ConnectedApps,
    Tools: Send + Sync + 'static,
{
    async fn validate(
        &self,
        command: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        let persona = self.select(&command).await?;
        Ok(ValidatedRoutineSession {
            managed: matches!(persona, SelectedPersona::Managed(_)),
        })
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        validate_session_id(command.session_id)?;
        let persona = self.select(&command.selection).await?;
        let selection = command.selection;
        let owner = Owner::User(selection.owner.clone());
        let session = match persona {
            SelectedPersona::Managed(mut profile) => {
                if let Some(managed) = &mut profile.profile {
                    add_routine_apps(&mut managed.mcp_servers, &selection.mcp_servers);
                }
                self.opener
                    .open_managed_session(OpenManagedSession {
                        id: Some(command.session_id),
                        repo_url: None,
                        repo_branch: None,
                        owner: owner.clone(),
                        prompt: None,
                        profile: Some(profile),
                        instructions: None,
                        model: selection.model.clone(),
                        source: command.source,
                        visibility: command.visibility,
                    })
                    .await
            }
            SelectedPersona::External { bot_id } => {
                self.external
                    .request(RequestedExternalSession {
                        session_id: command.session_id,
                        bot_id,
                        owner: selection.owner,
                        repo_url: None,
                        model: selection.model.clone(),
                        source: command.source,
                        visibility: command.visibility,
                    })
                    .await
            }
        }
        .map_err(session_error)?;
        if session.id != command.session_id
            || session.bot_id != selection.bot_id
            || session.owner_id != owner
        {
            return Err(RoutineSessionError::SessionMismatch);
        }
        if selection
            .model
            .as_ref()
            .is_some_and(|model| *model != session.model)
        {
            return Err(RoutineSessionError::ModelMismatch);
        }
        Ok(PreparedRoutineSession {
            session_id: session.id,
        })
    }

    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        let action = command.action;
        self.owned_session(&action).await?;
        if command.prompt.trim().is_empty() {
            return Err(RoutineSessionError::InvalidCommand);
        }
        let log = self
            .sessions
            .session_log(action.session_id)
            .await
            .map_err(session_error)?;
        let mut fold = LifecycleFold::new();
        for row in log.entries {
            let _ = fold.push(row.entry);
        }
        if fold
            .inner()
            .messages()
            .iter()
            .any(|message| matches!(message.author, Author::User { .. }))
            || !self
                .controls
                .queued_controls(action.session_id)
                .await
                .map_err(session_error)?
                .is_empty()
        {
            return Err(RoutineSessionError::Conflict);
        }
        // A history check is a guard against known replays, not an exactly-once
        // transaction. Never retry this call after a lost or failed response.
        let accepted = self
            .controls
            .control_event(
                action.session_id,
                ControlEvent {
                    action: AgentAction::prompt(command.prompt),
                    action_id: Some(action.action_id),
                    actor: Some(action.owner),
                    context: command.context,
                },
            )
            .await
            .map_err(prompt_error)?;
        if accepted.action_id != action.action_id {
            return Err(RoutineSessionError::PromptDeliveryUnknown);
        }
        Ok(RoutinePromptAccepted {
            action_id: accepted.action_id,
            queued: accepted.disposition == ControlDisposition::Queued,
        })
    }

    async fn status(
        &self,
        command: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        let session = self.owned_session(&command).await?;
        let log = self
            .sessions
            .session_log(command.session_id)
            .await
            .map_err(session_error)?;
        Ok(action_status(
            log.entries,
            command.action_id,
            &session.status,
        ))
    }

    async fn cancel(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.owned_session(&command).await?;
        // A stop is a separate control, never another prompt under the initial id.
        self.controls
            .control_event(
                command.session_id,
                ControlEvent {
                    action: AgentAction::Stop,
                    action_id: Some(AgentActionId::mint()),
                    actor: Some(command.owner),
                    context: None,
                },
            )
            .await
            .map_err(session_error)?;
        Ok(())
    }
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

fn validate_session_id(id: AgentSessionId) -> Result<(), RoutineSessionError> {
    if id.as_uuid().get_version_num() != 7 {
        return Err(RoutineSessionError::InvalidCommand);
    }
    Ok(())
}

fn prompt_error(error: AgentSessionError) -> RoutineSessionError {
    match error {
        #[cfg(feature = "admission")]
        AgentSessionError::Admission(error) => RoutineSessionError::Admission(error),
        _ => RoutineSessionError::PromptDeliveryUnknown,
    }
}

fn session_error(error: AgentSessionError) -> RoutineSessionError {
    match error {
        #[cfg(feature = "admission")]
        AgentSessionError::Admission(error) => RoutineSessionError::Admission(error),
        AgentSessionError::Forbidden
        | AgentSessionError::UnknownOwner
        | AgentSessionError::OwnerNotUser(_) => RoutineSessionError::Forbidden,
        AgentSessionError::SessionIdTaken(_) => RoutineSessionError::Conflict,
        AgentSessionError::RuntimeUnavailable(_) | AgentSessionError::Disconnected(_) => {
            RoutineSessionError::RuntimeUnavailable
        }
        _ => RoutineSessionError::OperationFailed,
    }
}

#[cfg(test)]
mod test;
