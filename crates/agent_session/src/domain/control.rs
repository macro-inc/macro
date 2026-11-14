//! Human approval remains distinct from a runtime forwarding a user's prompt.

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use trigger_context::TriggerContext;

use super::error::{AgentSessionError, Result};
use super::model::UiClientId;
use super::ports::ControlEvent;

/// The authenticated principal, before an acting-user claim erases its origin.
pub enum ControlPrincipal {
    /// A user authenticated directly, including a user API key.
    User,
    /// A user's credential used by an agent's program: the user's authority,
    /// but no right to answer interactions or name an app tab.
    Program,
    /// A bot, daemon, or internal service, possibly forwarding a user's request.
    Runtime(Option<MacroUserIdStr<'static>>),
}

impl ControlPrincipal {
    /// The app tab a prompt from this principal is recorded against.
    ///
    /// Only the person typing in a tab may name it: a runtime forwarding a
    /// prompt has no tab, and naming one would let it steer whatever the turn
    /// shows into a tab it never saw, so it is refused. A program using a
    /// person's credential keeps the person's authority but not their tab, so
    /// its tab is dropped rather than refused.
    pub fn admit_client(&self, client: Option<UiClientId>) -> Result<Option<UiClientId>> {
        match (self, client) {
            (Self::User, client) => Ok(client),
            (Self::Program, _) | (Self::Runtime(_), None) => Ok(None),
            (Self::Runtime(_), Some(_)) => Err(AgentSessionError::Forbidden),
        }
    }
}

impl ControlEvent {
    /// Only a directly authenticated user with edit access may answer an interaction.
    /// Programs and runtimes may forward ordinary controls, but cannot use a
    /// user's identity to answer their own permission or elicitation.
    ///
    /// Trigger context is only accepted from a runtime forwarding a prompt it
    /// was triggered with. A user could otherwise tell an owner's agent that
    /// the owner asked for something.
    ///
    /// An app tab is only accepted from the person typing in it; see
    /// [`ControlPrincipal::admit_client`].
    pub fn authorized(
        action: AgentAction,
        action_id: Option<AgentActionId>,
        context: Option<TriggerContext>,
        client: Option<UiClientId>,
        principal: ControlPrincipal,
        access: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<Self> {
        // Notification metadata is authored inside the harness, never by API callers.
        if matches!(&action, AgentAction::Prompt(prompt) if prompt.notifications.is_some()) {
            return Err(AgentSessionError::Forbidden);
        }

        if !matches!(principal, ControlPrincipal::User)
            && matches!(
                action,
                AgentAction::RespondToPermission(_) | AgentAction::RespondElicitation(_)
            )
        {
            return Err(AgentSessionError::Forbidden);
        }

        let client = principal.admit_client(client)?;
        let actor = match principal {
            ControlPrincipal::User | ControlPrincipal::Program if context.is_some() => {
                return Err(AgentSessionError::Forbidden);
            }
            ControlPrincipal::User | ControlPrincipal::Program => Some(
                access
                    .get_authenticated_user()
                    .map_err(|_| AgentSessionError::Forbidden)?
                    .clone(),
            ),
            ControlPrincipal::Runtime(actor) => actor,
        };
        Ok(Self {
            action,
            action_id,
            actor,
            context,
            client,
        })
    }
}

#[cfg(test)]
mod test;
