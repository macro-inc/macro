use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use cron::Schedule as CronSchedule;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::{Owner, OwnerType};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;
use utoipa::ToSchema;

use super::event_runs::ConfigurationRevision;
use super::event_trigger::ActionTrigger;

#[cfg(test)]
mod test;

pub const MAX_ACTION_TIME: Duration = Duration::minutes(20);

#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct Schedule(String);

impl Schedule {
    /// Parse a cron expression in the 6-/7-field format required by the `cron`
    /// crate (`sec min hour dom mon dow [year]`).
    pub fn from_cron(cron: String) -> Result<Self> {
        CronSchedule::from_str(&cron).map_err(anyhow::Error::from)?;
        Ok(Self(cron))
    }

    pub fn as_cron(&self) -> CronSchedule {
        CronSchedule::from_str(&self.0).expect("always valid schedule")
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Next firing time after "now" in the given timezone, expressed in UTC.
    pub fn next_run_after_now(&self, tz: Tz) -> Option<DateTime<Utc>> {
        self.as_cron()
            .upcoming(tz)
            .next()
            .map(|dt| dt.with_timezone(&Utc))
    }
}

impl<'de> Deserialize<'de> for Schedule {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Schedule::from_cron(s).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, ToSchema)]
pub enum ActionKind {
    Agent,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct AgentTask {
    pub model: String,
    pub prompt: String,
    pub user_prompt: String,
}

/// Canonical client configuration. Ownership and execution state are server-owned.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ActionConfiguration {
    pub name: String,
    pub trigger: ActionTrigger,
    pub kind: ActionKind,
    #[schema(value_type = Object)]
    pub task: Value,
    pub enabled: bool,
}

/// Deprecated cron-only input, accepted during the compatibility rollout.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LegacyActionConfiguration {
    pub name: String,
    pub schedule: Schedule,
    pub kind: ActionKind,
    #[schema(value_type = String)]
    pub timezone: Tz,
    #[schema(value_type = Object)]
    pub task: Value,
    pub enabled: bool,
}

impl From<LegacyActionConfiguration> for ActionConfiguration {
    fn from(input: LegacyActionConfiguration) -> Self {
        Self {
            name: input.name,
            trigger: ActionTrigger::Cron {
                schedule: input.schedule,
                timezone: input.timezone,
            },
            kind: input.kind,
            task: input.task,
            enabled: input.enabled,
        }
    }
}

/// Exactly one representation is accepted, even if mixed fields agree or are null.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(untagged)]
pub enum CreateScheduledAction {
    Canonical(ActionConfiguration),
    Legacy(LegacyActionConfiguration),
}

/// Full replacement of client configuration, not of server-owned action state.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(untagged)]
pub enum UpdateScheduledAction {
    Canonical(ActionConfiguration),
    Legacy(LegacyActionConfiguration),
}

impl From<CreateScheduledAction> for ActionConfiguration {
    fn from(input: CreateScheduledAction) -> Self {
        match input {
            CreateScheduledAction::Canonical(input) => input,
            CreateScheduledAction::Legacy(input) => input.into(),
        }
    }
}

impl From<UpdateScheduledAction> for ActionConfiguration {
    fn from(input: UpdateScheduledAction) -> Self {
        match input {
            UpdateScheduledAction::Canonical(input) => input,
            UpdateScheduledAction::Legacy(input) => input.into(),
        }
    }
}

/// Expected management failures; adapters map these without exposing internals.
#[derive(Debug, thiserror::Error)]
pub enum ActionPolicyError {
    #[error("scheduled action not found")]
    NotFound,
    #[error("schedule has no future firings")]
    NoFutureFirings,
    #[error("event-trigger management is not enabled")]
    EventManagementDisabled,
    #[error("scheduled action changed or is running; reload before updating")]
    UpdateConflict,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct ScheduledAction {
    #[schema(value_type = Option<String>, format = Uuid)]
    pub id: Option<Uuid>,
    /// Who the action belongs to. Every action is user-owned today, but the
    /// type no longer says so: the principal string on the wire and in the
    /// `owner` column is the same, and a bot- or team-owned row decodes
    /// rather than failing to parse.
    #[schema(value_type = String)]
    pub owner: Owner,
    pub name: String,
    pub trigger: ActionTrigger,
    pub kind: ActionKind,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Independent of execution bookkeeping in `updated_at`.
    #[schema(value_type = i64)]
    pub configuration_revision: ConfigurationRevision,
    /// Event publication boundary; absent for cron actions.
    pub event_activated_at: Option<DateTime<Utc>>,
    #[schema(value_type = Object)]
    pub task: Value,
    pub claimed: Option<DateTime<Utc>>,
    /// Next cron firing, absent for event-triggered actions.
    pub next_run_at: Option<DateTime<Utc>>,
    /// When false, automatic dispatch skips this action. `run_now` remains
    /// available regardless.
    pub enabled: bool,
}

impl ScheduledAction {
    /// The user this action runs as.
    ///
    /// For every path that acts as the owner rather than merely naming them:
    /// creating a chat in their account, reading their memory, spending their
    /// AI budget, notifying them. Asking here fails typed for a bot or team
    /// instead of treating one as a person.
    pub fn owner_user(&self) -> Result<&MacroUserIdStr<'static>, OwnerNotUserError> {
        self.owner.as_user().ok_or(OwnerNotUserError {
            owner_type: self.owner.owner_type(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InProgressExecution {
    #[schema(value_type = String, format = Uuid)]
    pub action_id: Uuid,
    pub chat_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct ActionExecutionRecord {
    #[schema(value_type = Option<String>, format = Uuid)]
    pub id: Option<Uuid>,
    #[schema(value_type = String, format = Uuid)]
    pub action_id: Uuid,
    /// ID of the primary resource produced by this run (e.g. a chat thread).
    /// Opaque to the scheduler; the UI interprets it based on the action kind.
    pub resource_id: Option<String>,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub is_success: bool,
    #[schema(value_type = Object)]
    pub result: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug)]
pub enum DispatchEvent {
    Create(ScheduledAction),
    Update(ScheduledAction),
    Delete(ScheduledAction),
}

/// Live status update for a scheduled-action run, broadcast via the connection
/// gateway to the owner. Clients use the `chat_id` to navigate to the run
/// transcript and the variant tag to toggle the running indicator.
///
/// Serialized with a `type` tag (`started`/`stopped`) and delivered over the
/// single `scheduled_action_update` message type on the gateway.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScheduledActionUpdate {
    Started {
        #[schema(value_type = String)]
        owner: MacroUserIdStr<'static>,
        #[schema(value_type = String, format = Uuid)]
        action_id: Uuid,
        chat_id: String,
    },
    Stopped {
        #[schema(value_type = String)]
        owner: MacroUserIdStr<'static>,
        #[schema(value_type = String, format = Uuid)]
        action_id: Uuid,
        chat_id: String,
        is_success: bool,
    },
}

impl ScheduledActionUpdate {
    pub fn owner(&self) -> &MacroUserIdStr<'static> {
        match self {
            ScheduledActionUpdate::Started { owner, .. } => owner,
            ScheduledActionUpdate::Stopped { owner, .. } => owner,
        }
    }
}

/// Message type on connection_gateway for live scheduled-action updates. The
/// payload is a serialized [`ScheduledActionUpdate`]; the variant tag lives
/// inside the payload so the wire surface stays as one message type.
pub const SCHEDULED_ACTION_UPDATE_MESSAGE_TYPE: &str = "scheduled_action_update";

/// Returned by the executor when a run cannot start because the action is
/// already claimed by another in-flight execution. Callers at the HTTP
/// boundary map this to 409 Conflict; the polling dispatcher treats it as a
/// benign "another worker got there first" signal.
#[derive(Debug)]
pub struct AlreadyRunningError {
    pub action_id: Uuid,
}

impl std::fmt::Display for AlreadyRunningError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "scheduled action {} is already running", self.action_id)
    }
}

impl std::error::Error for AlreadyRunningError {}

/// Returned when a path that must run as a person meets an action owned by a
/// bot or a team. Callers at the HTTP boundary map this to 400 Bad Request;
/// the polling dispatcher logs it and leaves the action alone.
#[derive(Debug)]
pub struct OwnerNotUserError {
    pub owner_type: OwnerType,
}

impl std::fmt::Display for OwnerNotUserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "this path needs a user-owned scheduled action, but the owner is a {}",
            self.owner_type
        )
    }
}

impl std::error::Error for OwnerNotUserError {}
