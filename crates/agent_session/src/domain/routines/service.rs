use agent_fold::domain::lifecycle::LifecycleFold;
use agent_fold::domain::model::Author;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use model_owner::Owner;

use super::status::action_status;
use super::{RoutineSessions, models::*};
use crate::domain::error::AgentSessionError;
use crate::domain::model::{AgentSession, AgentSessionId};
use crate::domain::ports::{
    AgentSessionNotificationRecipient, BotDirectory, ControlDisposition, ControlEvent,
    ExternalSessionRequester, ManagedPersonaError, OpenManagedSession, RequestedExternalSession,
    SelectedPersona, SessionOpener, persona_for_owner,
};
use crate::domain::service::AgentSessionService;

/// Domain orchestration using the same provisioning and controls as interactive sessions.
#[derive(Clone)]
pub struct RoutineSessionsService<Bots, Opener, External, Sessions, Controls> {
    bots: Bots,
    opener: Opener,
    external: External,
    sessions: Sessions,
    controls: Controls,
}

impl<Bots, Opener, External, Sessions, Controls>
    RoutineSessionsService<Bots, Opener, External, Sessions, Controls>
{
    /// Compose existing capabilities; no new runtime or persistence implementation.
    pub fn new(
        bots: Bots,
        opener: Opener,
        external: External,
        sessions: Sessions,
        controls: Controls,
    ) -> Self {
        Self {
            bots,
            opener,
            external,
            sessions,
            controls,
        }
    }
}

impl<Bots, Opener, External, Sessions, Controls>
    RoutineSessionsService<Bots, Opener, External, Sessions, Controls>
where
    Bots: BotDirectory,
    Sessions: AgentSessionService,
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
        persona_for_owner(
            &self.bots,
            selection.bot_id,
            &Owner::User(selection.owner.clone()),
        )
        .await
        .map_err(|error| match error {
            ManagedPersonaError::Forbidden => RoutineSessionError::Forbidden,
            ManagedPersonaError::Lookup(error) => session_error(error),
            ManagedPersonaError::Unknown
            | ManagedPersonaError::NotAgent
            | ManagedPersonaError::UnmanagedSystemBot => RoutineSessionError::PersonaUnavailable,
        })
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

impl<Bots, Opener, External, Sessions, Controls> RoutineSessions
    for RoutineSessionsService<Bots, Opener, External, Sessions, Controls>
where
    Bots: BotDirectory,
    Opener: SessionOpener,
    External: ExternalSessionRequester,
    Sessions: AgentSessionService,
    Controls: AgentSessionNotificationRecipient,
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
            SelectedPersona::Managed(profile) => {
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
                    })
                    .await
            }
            SelectedPersona::External { bot_id } => {
                self.external
                    .request(RequestedExternalSession {
                        session_id: command.session_id,
                        bot_id,
                        owner: selection.owner,
                        model: selection.model.clone(),
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
                },
            )
            .await
            .map_err(|_| RoutineSessionError::PromptDeliveryUnknown)?;
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
                },
            )
            .await
            .map_err(session_error)?;
        Ok(())
    }
}

fn validate_session_id(id: AgentSessionId) -> Result<(), RoutineSessionError> {
    if id.as_uuid().get_version_num() != 7 {
        return Err(RoutineSessionError::InvalidCommand);
    }
    Ok(())
}

fn session_error(error: AgentSessionError) -> RoutineSessionError {
    match error {
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
