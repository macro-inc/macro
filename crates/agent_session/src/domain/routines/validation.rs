use std::time::Duration;

use model_owner::Owner;

use super::{ConnectedApps, RoutineSessionError, ValidateRoutineSession, service::session_error};
use crate::domain::ports::{BotDirectory, ManagedPersonaError, SelectedPersona, persona_for_owner};

// Keep the per-selection deadline of the internal validation route.
const SELECTION_TIMEOUT: Duration = Duration::from_secs(30);

/// Configuration validation of the agent selections in one owner's routine.
pub trait RoutineSessionValidation: Send + Sync + 'static {
    /// Authorize the selections without opening a session or contacting its runtime.
    fn validate_selections(
        &self,
        selections: &[ValidateRoutineSession],
    ) -> impl Future<Output = Result<(), RoutineSessionError>> + Send;
}

/// The session policy for selecting personas and required apps.
#[derive(Clone)]
pub struct RoutineSessionValidator<Bots, Apps> {
    bots: Bots,
    apps: Apps,
}

impl<Bots, Apps> RoutineSessionValidator<Bots, Apps> {
    /// Use the same persona directory and app connections as session preparation.
    pub fn new(bots: Bots, apps: Apps) -> Self {
        Self { bots, apps }
    }
}

impl<Bots: BotDirectory, Apps: ConnectedApps> RoutineSessionValidator<Bots, Apps> {
    pub(super) async fn select(
        &self,
        selection: &ValidateRoutineSession,
        connected: &mut Option<Vec<String>>,
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
            ManagedPersonaError::TeamAgentComputer => RoutineSessionError::TeamAgentComputer,
            ManagedPersonaError::Lookup(error) => session_error(error),
            ManagedPersonaError::Unknown
            | ManagedPersonaError::NotAgent
            | ManagedPersonaError::UnmanagedSystemBot => RoutineSessionError::PersonaUnavailable,
        })?;
        self.require_apps(selection, &persona, connected).await?;
        Ok(persona)
    }

    /// Checked on save and again before every run, so an app disconnected
    /// since fails the run instead of leaving the agent without it.
    async fn require_apps(
        &self,
        selection: &ValidateRoutineSession,
        persona: &SelectedPersona,
        connected: &mut Option<Vec<String>>,
    ) -> Result<(), RoutineSessionError> {
        if selection.mcp_servers.is_empty() {
            return Ok(());
        }
        if matches!(persona, SelectedPersona::External { .. }) {
            return Err(RoutineSessionError::AppsUnsupported);
        }
        let connected = match connected {
            Some(apps) => apps,
            None => connected.insert(
                self.apps
                    .connected_app_slugs(&selection.owner)
                    .await
                    .map_err(|error| {
                        tracing::warn!(error = ?error, "could not list a routine owner's connected apps");
                        RoutineSessionError::OperationFailed
                    })?,
            ),
        };
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
}

impl<Bots: BotDirectory, Apps: ConnectedApps> RoutineSessionValidation
    for RoutineSessionValidator<Bots, Apps>
{
    #[tracing::instrument(name = "routine.validate_selections", skip_all, fields(selections = selections.len()), err)]
    async fn validate_selections(
        &self,
        selections: &[ValidateRoutineSession],
    ) -> Result<(), RoutineSessionError> {
        let Some(first) = selections.first() else {
            return Ok(());
        };
        let mut connected = None;
        for selection in selections {
            if selection.owner != first.owner {
                return Err(RoutineSessionError::InvalidCommand);
            }
            tokio::time::timeout(SELECTION_TIMEOUT, self.select(selection, &mut connected))
                .await
                .map_err(|_| RoutineSessionError::OperationFailed)??;
        }
        Ok(())
    }
}
