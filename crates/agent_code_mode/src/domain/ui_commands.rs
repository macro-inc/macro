//! A running program showing the person who prompted its turn something in
//! the Macro app tab they typed in (`macro.ui.open`).
//!
//! Only a turn a person prompted from a tab can do this, and only that
//! person's tab: the command is addressed to the tab the prompt came from and
//! sent to that person's own connections, which ignore it unless the tab is
//! theirs. Routines, triggers and channel mentions have no tab, so they are
//! answered `no_client` and nothing is sent. What to show is an app path that
//! must match a route the web app opened to agents, checked here and again by
//! the tab against its real route table. Each turn and each person has a
//! budget, so a program that reads an instruction in an email cannot flood
//! anyone's screen.
//!
//! Phase one is fire and forget: `sent` means a connection of that person
//! took the frame, not that the pane opened.

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::{AgentSessionId, TurnPrompter, UiClientId};
use ai_toolset::actor::ToolActor;
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use utoipa::ToSchema;

use super::{CodeModeError, ExecutionId, ExecutionStatus, ExecutionStore, ExecutionTurns};

mod routes;
pub use routes::{AppPath, NavigableRoutes};

#[cfg(test)]
mod test;

/// Commands one turn may send.
pub const MAX_COMMANDS_PER_TURN: u32 = 5;
/// New panes one turn may open.
pub const MAX_NEW_PANES_PER_TURN: u32 = 3;
/// Commands one person may receive a minute, across every session.
pub const MAX_COMMANDS_PER_USER_MINUTE: u32 = 30;

/// How long a turn's budget lasts: far longer than any turn runs, so the
/// budget is per turn in practice.
const TURN_BUDGET_WINDOW: Duration = Duration::from_secs(6 * 60 * 60);
const USER_BUDGET_WINDOW: Duration = Duration::from_secs(60);

/// Where the opened item goes. Neither replaces what the person is reading.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum UiPlacement {
    /// A new pane next to the one showing this agent's session, or a new
    /// pane when no pane shows it.
    #[default]
    BesideAgent,
    /// A new pane at the end of the layout.
    New,
}

/// Open an item in the prompting person's app tab.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenInApp {
    /// The running execution asking; it must belong to the session's
    /// current turn.
    pub execution_id: ExecutionId,
    /// An app path, such as `/md/<id>` or `/channels/<id>?s0.channels.messageId=<id>`:
    /// what follows `/app` in a Macro link. Never an origin.
    pub path: String,
    /// Where to put it; beside the agent by default.
    #[serde(default)]
    pub placement: UiPlacement,
}

/// Why a command was not sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum UiDeclineReason {
    /// Agent navigation is off for this person.
    TurnedOff,
    /// The path is not a route agents may open.
    NotAllowedRoute,
    /// The turn or the person has used up their commands.
    RateLimited,
}

/// What happened to a command.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UiCommandOutcome {
    /// A connection of the prompting person took it. Their tab opens it
    /// unless it refuses the route or the person is somewhere else.
    Sent {
        /// The command's id, as the tab sees it.
        #[serde(rename = "commandId")]
        command_id: Uuid,
    },
    /// Nobody to show it to: a turn nobody typed in a tab, or the tab is
    /// not connected. Link the item in the reply instead.
    NoClient,
    /// Not sent, for the given reason.
    Declined {
        /// Why.
        reason: UiDeclineReason,
    },
}

/// The frame the prompting person's connections receive as `ui_command`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiCommandFrame {
    /// Identifies this command.
    pub command_id: Uuid,
    /// The person it is for; a tab signed in as anybody else ignores it.
    pub user_id: MacroUserIdStr<'static>,
    /// The tab it is for; every other tab ignores it.
    pub client_id: UiClientId,
    /// The session whose agent sent it.
    pub session_id: AgentSessionId,
    /// What to do. Only `open` exists.
    pub kind: UiCommandKind,
    /// The checked app path.
    pub path: String,
    /// Where to put it.
    pub placement: UiPlacement,
}

/// The verbs a tab applies.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UiCommandKind {
    /// Open an item in a new pane.
    Open,
}

impl UiCommandKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
        }
    }
}

/// Who a session's current turn can show things to.
#[derive(Clone, Debug)]
pub struct UiTurn {
    /// The session owner, which an execution acting as the owner resolves to.
    pub owner: MacroUserIdStr<'static>,
    /// Who prompted the turn the session runs or last ran.
    pub prompter: Option<TurnPrompter>,
}

/// One budget a command spends from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UiBudget {
    /// What the budget belongs to.
    pub scope: UiBudgetScope,
    /// How many it allows in its window.
    pub max: u32,
    /// How long the window lasts.
    pub window: Duration,
}

/// What a budget belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UiBudgetScope {
    /// Commands in one turn.
    TurnCommands(AgentActionId),
    /// New panes in one turn.
    TurnNewPanes(AgentActionId),
    /// Commands to one person.
    Person(MacroUserIdStr<'static>),
}

/// The session's turn, as the command channel needs it.
#[async_trait]
pub trait UiTurns: Send + Sync + 'static {
    /// The owner and the current turn's prompter.
    async fn turn(&self, session: AgentSessionId) -> Result<UiTurn, CodeModeError>;
}

/// Whether agent navigation is on for a person.
#[async_trait]
pub trait UiNavigationFlag: Send + Sync + 'static {
    /// On for `user`. A flag that cannot be read counts as off.
    async fn enabled(&self, user: &MacroUserIdStr<'static>) -> bool;
}

/// Shared command budgets, the same on every replica.
#[async_trait]
pub trait UiCommandBudgets: Send + Sync + 'static {
    /// Spend one from every budget, or from none: false when any is used up.
    async fn spend(&self, budgets: &[UiBudget]) -> Result<bool, CodeModeError>;
}

/// Sends a frame to a person's open connections.
#[async_trait]
pub trait UiCommandDelivery: Send + Sync + 'static {
    /// Send `frame` to every connection `user` has open; how many took it.
    async fn send(
        &self,
        user: &MacroUserIdStr<'static>,
        frame: &UiCommandFrame,
    ) -> Result<u64, CodeModeError>;
}

/// Sends a running program's UI commands to the person who prompted its turn.
#[derive(Clone)]
pub struct UiCommandService {
    store: Arc<dyn ExecutionStore>,
    active: Arc<dyn ExecutionTurns>,
    turns: Arc<dyn UiTurns>,
    flag: Arc<dyn UiNavigationFlag>,
    budgets: Arc<dyn UiCommandBudgets>,
    delivery: Arc<dyn UiCommandDelivery>,
    routes: Arc<NavigableRoutes>,
}

/// The ports [`UiCommandService`] runs on.
pub struct UiCommandPorts {
    /// Execution records.
    pub store: Arc<dyn ExecutionStore>,
    /// The session's active turn.
    pub active: Arc<dyn ExecutionTurns>,
    /// The turn's owner and prompter.
    pub turns: Arc<dyn UiTurns>,
    /// The rollout flag.
    pub flag: Arc<dyn UiNavigationFlag>,
    /// Shared budgets.
    pub budgets: Arc<dyn UiCommandBudgets>,
    /// The connection gateway.
    pub delivery: Arc<dyn UiCommandDelivery>,
}

/// A program admitted to send: its turn and the account it acts as.
struct Admitted {
    session: AgentSessionId,
    turn: AgentActionId,
    turn_facts: UiTurn,
}

impl UiCommandService {
    /// Bind the ports to the web app's agent route table.
    pub fn new(ports: UiCommandPorts, routes: NavigableRoutes) -> Self {
        Self {
            store: ports.store,
            active: ports.active,
            turns: ports.turns,
            flag: ports.flag,
            budgets: ports.budgets,
            delivery: ports.delivery,
            routes: Arc::new(routes),
        }
    }

    /// Admit only a running execution of the session's current turn, called
    /// by the account that execution was approved to act as, as connected
    /// apps do: a finished, replayed or foreign program cannot send.
    async fn admit(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        execution: ExecutionId,
    ) -> Result<Admitted, CodeModeError> {
        let session =
            super::reviews::session_id(access.entity().entity_type, &access.entity().entity_id)?;
        if access.acting_user_id() != Some(caller) {
            return Err(CodeModeError::Forbidden);
        }

        let record = self.store.get(session, execution).await?;
        let active = self.active.active(session).await?;
        let (Some(acting_as), Some(turn)) = (record.acting_as, record.turn_id) else {
            return Err(CodeModeError::Forbidden);
        };
        if record.status != ExecutionStatus::Running || active != Some(turn) {
            return Err(CodeModeError::Forbidden);
        }

        let turn_facts = self.turns.turn(session).await?;
        let requester = turn_facts
            .prompter
            .as_ref()
            .and_then(TurnPrompter::acting_user);
        let acts_as = resolve(&acting_as, &turn_facts.owner, requester)?;
        if acts_as != caller {
            return Err(CodeModeError::Forbidden);
        }

        Ok(Admitted {
            session,
            turn: AgentActionId::from_uuid(turn),
            turn_facts,
        })
    }

    /// Open an item in the prompting person's tab, in a new pane.
    #[tracing::instrument(
        name = "ui.command.dispatch",
        skip_all,
        fields(
            agent_session.id = tracing::field::Empty,
            ui.command.id = tracing::field::Empty,
            ui.command.kind = UiCommandKind::Open.as_str(),
            ui.command.placement = ?input.placement,
            ui.route = tracing::field::Empty,
            ui.client.count = tracing::field::Empty,
            outcome = tracing::field::Empty,
        ),
        err
    )]
    pub async fn open(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        caller: &MacroUserIdStr<'static>,
        input: OpenInApp,
    ) -> Result<UiCommandOutcome, CodeModeError> {
        let span = tracing::Span::current();
        let admitted = self.admit(access, caller, input.execution_id).await?;
        span.record(
            "agent_session.id",
            tracing::field::display(admitted.session),
        );

        let outcome = self.dispatch(admitted, input).await?;
        span.record("outcome", outcome_label(&outcome));
        Ok(outcome)
    }

    async fn dispatch(
        &self,
        admitted: Admitted,
        input: OpenInApp,
    ) -> Result<UiCommandOutcome, CodeModeError> {
        let span = tracing::Span::current();
        let Some((user, client)) = prompting_tab(&admitted) else {
            return Ok(UiCommandOutcome::NoClient);
        };

        if !self.flag.enabled(user).await {
            return Ok(declined(UiDeclineReason::TurnedOff));
        }

        let Some(path) = self.routes.check(&input.path) else {
            return Ok(declined(UiDeclineReason::NotAllowedRoute));
        };
        span.record("ui.route", path.route_ids().join(","));

        let budgets = [
            UiBudget {
                scope: UiBudgetScope::TurnCommands(admitted.turn),
                max: MAX_COMMANDS_PER_TURN,
                window: TURN_BUDGET_WINDOW,
            },
            UiBudget {
                scope: UiBudgetScope::TurnNewPanes(admitted.turn),
                max: MAX_NEW_PANES_PER_TURN,
                window: TURN_BUDGET_WINDOW,
            },
            UiBudget {
                scope: UiBudgetScope::Person(user.clone()),
                max: MAX_COMMANDS_PER_USER_MINUTE,
                window: USER_BUDGET_WINDOW,
            },
        ];
        if !self.budgets.spend(&budgets).await? {
            return Ok(declined(UiDeclineReason::RateLimited));
        }

        let frame = UiCommandFrame {
            command_id: macro_uuid::generate_uuid_v7(),
            user_id: user.clone(),
            client_id: client,
            session_id: admitted.session,
            kind: UiCommandKind::Open,
            path: path.into_string(),
            placement: input.placement,
        };
        span.record("ui.command.id", tracing::field::display(frame.command_id));

        let delivered = self.delivery.send(user, &frame).await?;
        span.record(
            "ui.client.count",
            i64::try_from(delivered).unwrap_or(i64::MAX),
        );
        if delivered == 0 {
            return Ok(UiCommandOutcome::NoClient);
        }

        Ok(UiCommandOutcome::Sent {
            command_id: frame.command_id,
        })
    }
}

/// The person and tab a turn may show things to: a person's own turn, typed
/// in a tab. A system turn never has one, whatever its row holds.
fn prompting_tab(admitted: &Admitted) -> Option<(&MacroUserIdStr<'static>, UiClientId)> {
    let prompter = admitted.turn_facts.prompter.as_ref()?;
    if prompter.action_id != admitted.turn {
        return None;
    }

    let user = prompter.acting_user()?;
    let client = prompter.client?;
    Some((user, client))
}

fn resolve<'a>(
    acting_as: &ToolActor,
    owner: &'a MacroUserIdStr<'static>,
    requester: Option<&'a MacroUserIdStr<'static>>,
) -> Result<&'a MacroUserIdStr<'static>, CodeModeError> {
    acting_as
        .resolve(owner, requester)
        .map_err(|_| CodeModeError::Forbidden)
}

fn declined(reason: UiDeclineReason) -> UiCommandOutcome {
    UiCommandOutcome::Declined { reason }
}

fn outcome_label(outcome: &UiCommandOutcome) -> &'static str {
    match outcome {
        UiCommandOutcome::Sent { .. } => "sent",
        UiCommandOutcome::NoClient => "no_client",
        UiCommandOutcome::Declined {
            reason: UiDeclineReason::TurnedOff,
        } => "declined.turned_off",
        UiCommandOutcome::Declined {
            reason: UiDeclineReason::NotAllowedRoute,
        } => "declined.not_allowed_route",
        UiCommandOutcome::Declined {
            reason: UiDeclineReason::RateLimited,
        } => "declined.rate_limited",
    }
}
