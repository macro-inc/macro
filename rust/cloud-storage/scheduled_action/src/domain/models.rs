use ai::types::Model;
use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use cron::Schedule as CronSchedule;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;
use utoipa::ToSchema;

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

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub enum ActionKind {
    Agent,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct AgentTask {
    pub model: Model,
    pub prompt: String,
    pub user_prompt: String,
}

/// Client-supplied payload for creating a scheduled action. The server fills
/// in `id`, `owner` (from the authenticated user), timestamps, `claimed`, and
/// `next_run_at` (derived from the cron).
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct CreateScheduledAction {
    pub name: String,
    pub schedule: Schedule,
    pub kind: ActionKind,
    #[schema(value_type = String)]
    pub timezone: Tz,
    #[schema(value_type = Object)]
    pub task: Value,
    pub enabled: bool,
}

/// Client-supplied payload for updating a scheduled action. Mirrors the fields
/// the repository actually writes — `id`/`owner`/timestamps/`claimed`/
/// `next_run_at` are not client-mutable.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct UpdateScheduledAction {
    pub name: String,
    pub schedule: Schedule,
    pub kind: ActionKind,
    #[schema(value_type = String)]
    pub timezone: Tz,
    #[schema(value_type = Object)]
    pub task: Value,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct ScheduledAction {
    #[schema(value_type = Option<String>, format = Uuid)]
    pub id: Option<Uuid>,
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    pub name: String,
    pub schedule: Schedule,
    pub kind: ActionKind,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[schema(value_type = String)]
    pub timezone: Tz,
    #[schema(value_type = Object)]
    pub task: Value,
    pub claimed: Option<DateTime<Utc>>,
    /// Time of the next scheduled firing (derived from the cron on write). UI
    /// uses this to render "next run" without having to parse the cron itself.
    pub next_run_at: DateTime<Utc>,
    /// When false, the cron dispatcher skips this schedule. `run_now` remains
    /// available regardless.
    pub enabled: bool,
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
