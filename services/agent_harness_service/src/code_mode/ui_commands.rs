//! Adapters for a running program's UI commands (`macro.ui.open`): the
//! session's turn, the rollout flag, shared budgets in Redis and delivery
//! through the connection gateway. `UiCommandService` decides everything;
//! these only answer and carry.

use agent_code_mode::domain::CodeModeError;
use agent_code_mode::domain::ui_commands::{
    UiBudget, UiBudgetScope, UiCommandBudgets, UiCommandDelivery, UiCommandFrame, UiNavigationFlag,
    UiTurn, UiTurns,
};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentSessionRepo;
use async_trait::async_trait;
use connection_gateway_client::ConnectionGatewayClient;
use entity_kind::EntityType;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitService};
use std::sync::Arc;

/// The PostHog flag, the same key the web app reads.
const NAVIGATION_FLAG: &str = "enable-agent-navigation";

/// The gateway message type the web app handles.
const UI_COMMAND_MESSAGE: &str = "ui_command";

/// Budget keys are hashed under this prefix, apart from other features' keys.
const BUDGET_KEY_PREFIX: &str = "agent-ui-command";

fn storage(error: impl std::fmt::Display) -> CodeModeError {
    CodeModeError::Storage(rootcause::report!("{error}"))
}

/// The session's owner and the prompter of its current turn.
pub struct SessionUiTurns<Sessions>(pub Sessions);

#[async_trait]
impl<Sessions: AgentSessionRepo> UiTurns for SessionUiTurns<Sessions> {
    async fn turn(&self, session: AgentSessionId) -> Result<UiTurn, CodeModeError> {
        let record = self.0.get(session).await.map_err(storage)?;
        let owner = record
            .owner_id
            .as_user()
            .cloned()
            .ok_or(CodeModeError::Forbidden)?;
        let prompter = self.0.turn_prompter(session).await.map_err(storage)?;
        let agent_name = self
            .0
            .session_bot(record.bot_id)
            .await
            .map_err(storage)?
            .name;

        Ok(UiTurn {
            owner,
            prompter,
            agent_name,
        })
    }
}

/// `enable-agent-navigation` for one person. Without a flag client (local
/// stacks without PostHog) or when the flags can't be read, it is off.
pub struct NavigationFlag<Flags>(pub Option<Flags>);

#[async_trait]
impl<Flags: FeatureFlags + 'static> UiNavigationFlag for NavigationFlag<Flags> {
    async fn enabled(&self, user: &MacroUserIdStr<'static>) -> bool {
        let Some(flags) = &self.0 else {
            return false;
        };

        flags
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "could not read the agent navigation flag");
            })
            .is_ok_and(|snapshot| snapshot.is_enabled(NAVIGATION_FLAG))
    }
}

/// Budgets as Redis sliding windows, shared by every replica.
pub struct RedisUiBudgets<Limiter>(pub Limiter);

fn budget_key(scope: &UiBudgetScope) -> RateLimitKey {
    let builder = RateLimitKey::builder(&BUDGET_KEY_PREFIX);
    match scope {
        UiBudgetScope::TurnCommands(turn) => builder.append(&"turn").append(&turn.as_uuid()),
        UiBudgetScope::TurnNewPanes(turn) => builder.append(&"panes").append(&turn.as_uuid()),
        UiBudgetScope::Person(user) => builder.append(&"person").append(&user.as_ref()),
    }
    .finish()
}

#[async_trait]
impl<Limiter: RateLimitService> UiCommandBudgets for RedisUiBudgets<Limiter> {
    async fn spend(&self, budgets: &[UiBudget]) -> Result<bool, CodeModeError> {
        let mut spent = Vec::with_capacity(budgets.len());

        for budget in budgets {
            let config = RateLimitConfig::new(u64::from(budget.max), budget.window);
            let checked = self
                .0
                .check_rate_limit(budget_key(&budget.scope), config)
                .await
                .map_err(storage)?;
            match checked {
                Ok(ticket) => spent.push(ticket),
                Err(_) => {
                    // All or nothing: give back what this command took.
                    for ticket in spent {
                        if let Err(error) = self.0.rollback_ticket(ticket).await {
                            tracing::warn!(error = ?error, "could not return a ui command budget");
                        }
                    }
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }
}

/// Sends frames to `user/{id}`: every connection the person has open.
pub struct GatewayUiDelivery(pub Arc<ConnectionGatewayClient>);

#[async_trait]
impl UiCommandDelivery for GatewayUiDelivery {
    #[tracing::instrument(name = "ui.command.send", skip_all, err)]
    async fn send(
        &self,
        user: &MacroUserIdStr<'static>,
        frame: &UiCommandFrame,
    ) -> Result<u64, CodeModeError> {
        let message = serde_json::to_value(frame).map_err(storage)?;
        let receipts = self
            .0
            .send_message(
                EntityType::User.with_entity_str(user.as_ref()),
                UI_COMMAND_MESSAGE.to_owned(),
                message,
            )
            .await
            .map_err(storage)?;

        Ok(receipts.iter().map(|receipt| receipt.delivery_count).sum())
    }
}
