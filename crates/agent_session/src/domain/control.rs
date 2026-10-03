//! Human approval remains distinct from a runtime forwarding a user's prompt.

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;

use super::error::{AgentSessionError, Result};
use super::ports::ControlEvent;

/// The authenticated principal, before an acting-user claim erases its origin.
pub enum ControlPrincipal {
    /// A user authenticated directly, including a user API key.
    User,
    /// A bot, daemon, or internal service, possibly forwarding a user's request.
    Runtime(Option<MacroUserIdStr<'static>>),
}

impl ControlEvent {
    /// Only an authenticated user with edit access may answer an interaction.
    /// Runtime principals may forward ordinary controls, but cannot use their
    /// acting-user identity to approve their own permission or elicitation.
    pub fn authorized(
        action: AgentAction,
        action_id: Option<AgentActionId>,
        principal: ControlPrincipal,
        access: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<Self> {
        let actor = match principal {
            ControlPrincipal::User => Some(
                access
                    .get_authenticated_user()
                    .map_err(|_| AgentSessionError::Forbidden)?
                    .clone(),
            ),
            ControlPrincipal::Runtime(actor) => {
                if matches!(
                    action,
                    AgentAction::RespondToPermission(_) | AgentAction::RespondElicitation(_)
                ) {
                    return Err(AgentSessionError::Forbidden);
                }
                actor
            }
        };
        Ok(Self {
            action,
            action_id,
            actor,
        })
    }
}

#[cfg(test)]
mod test;
