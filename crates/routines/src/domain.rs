//! Commands use the scheduler's existing cron engine, including single-year one-off schedules.
use anyhow::{Result, ensure};
use async_trait::async_trait;
use chrono::{DateTime, Datelike, Timelike, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Who executes the routine. Agent IDs refer to personas, never conversation IDs.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineTarget {
    /// A model running as Macro.
    Model {
        /// Runtime model ID.
        model: String,
    },
    /// An agent with its configured runtime, tools and default model.
    Agent {
        /// Persona/bot UUID from ListBots. Use your own persona ID to schedule yourself.
        #[serde(rename = "agentId")]
        agent_id: Uuid,
    },
}
/// A recurring or one-off schedule.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineSchedule {
    /// Execute once at a future timestamp, even if the creating session has ended.
    Once {
        /// RFC3339 timestamp including UTC offset.
        at: DateTime<Utc>,
    },
    /// Repeat using a six-field cron expression and an IANA time zone.
    Cron {
        /// Seconds, minutes, hours, day-of-month, month, weekday (optional year).
        expression: String,
        /// IANA time zone, e.g. America/New_York.
        timezone: String,
    },
}
impl RoutineSchedule {
    /// Validate and translate to the existing scheduler contract.
    pub fn cron(&self, now: DateTime<Utc>) -> Result<(String, String)> {
        let (schedule, timezone) = match self {
            Self::Once { at } => {
                ensure!(*at > now, "Choose a one-off time in the future.");
                (
                    format!(
                        "{} {} {} {} {} * {}",
                        at.second(),
                        at.minute(),
                        at.hour(),
                        at.day(),
                        at.month(),
                        at.year()
                    ),
                    "UTC".to_owned(),
                )
            }
            Self::Cron {
                expression,
                timezone,
            } => {
                let cron = expression.parse::<cron::Schedule>().map_err(|_| {
                    anyhow::anyhow!(
                        "Use a six-field cron: seconds minutes hours day-of-month month weekday."
                    )
                })?;
                let zone = timezone.parse::<chrono_tz::Tz>().map_err(|_| {
                    anyhow::anyhow!("Use an IANA timezone such as America/New_York.")
                })?;
                ensure!(
                    cron.after(&now.with_timezone(&zone)).next().is_some(),
                    "This schedule has no future runs."
                );
                (expression.clone(), timezone.clone())
            }
        };
        Ok((schedule, timezone))
    }
}
/// Complete user-editable configuration, independent of execution bookkeeping.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineConfiguration {
    /// Short descriptive name.
    pub name: String,
    /// Instructions passed to the model or agent on every run.
    pub instructions: String,
    /// Explicit model or agent selection.
    pub target: RoutineTarget,
    /// Time and repetition.
    pub schedule: RoutineSchedule,
}
impl RoutineConfiguration {
    /// Validate the user's intent independently of its transport representation.
    pub fn validate(&self, now: DateTime<Utc>) -> Result<()> {
        ensure!(!self.name.trim().is_empty(), "A routine name is required.");
        ensure!(
            !self.instructions.trim().is_empty(),
            "Routine instructions are required."
        );
        if let RoutineTarget::Model { model } = &self.target {
            ensure!(!model.trim().is_empty(), "Choose a nonblank model ID.");
        }
        self.schedule.cron(now)?;
        Ok(())
    }
}
/// Compact routine details returned to the caller.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInfo {
    /// Routine identifier.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// Whether automatic runs are enabled.
    pub enabled: bool,
    /// Cron expression or event trigger, as stored by the scheduler.
    pub trigger: serde_json::Value,
    /// Execution target and instructions.
    pub task: serde_json::Value,
    /// Next scheduled firing, absent after a one-off completes.
    pub next_run_at: Option<DateTime<Utc>>,
}
/// A bounded list with the full matching count.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineList {
    /// Matching routines (most recent first).
    pub routines: Vec<RoutineInfo>,
    /// Total matches before the response limit.
    pub total: usize,
}
/// Routine configuration and recent execution history.
#[derive(Debug, Serialize, JsonSchema)]
pub struct RoutineDetails {
    /// Current saved configuration.
    pub routine: RoutineInfo,
    /// Most recent runs, up to fifty, including status and transcript references.
    pub runs: Vec<serde_json::Value>,
}
/// Owning-service capability: authorization remains in the scheduler, never the tools.
#[async_trait]
pub trait RoutineService: Send + Sync {
    /// Create for the authenticated user; target accessibility is checked server-side.
    async fn create(
        &self,
        user: &MacroUserIdStr<'static>,
        config: &RoutineConfiguration,
    ) -> Result<RoutineInfo>;
    /// List the authenticated user's routines, including routines targeting agents.
    async fn list(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<RoutineInfo>>;
    /// Read an accessible routine and its history.
    async fn read(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<RoutineDetails>;
    /// Replace configuration of an owned routine; activation is preserved.
    async fn update(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        config: &RoutineConfiguration,
    ) -> Result<RoutineInfo>;
    /// Pause/resume an owned routine independently of its configuration.
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        enabled: bool,
    ) -> Result<RoutineInfo>;
}
