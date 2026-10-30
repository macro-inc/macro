//! Commands use the scheduler's existing cron engine, including single-year
//! one-off schedules, and its program model for steps.
use anyhow::{Result, ensure};
use async_trait::async_trait;
use chrono::{DateTime, Datelike, Timelike, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{RoutineProgram, Step};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A recurring or one-off schedule, as the scheduler's cron trigger.
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
/// When a routine runs. Combine any schedules with any activity triggers.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineTrigger {
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
    /// Run when matching activity happens in Macro. Only people's actions
    /// trigger routines; changes made by routines and agents never do.
    Event {
        /// Any of these events starts a run.
        events: Vec<RoutineEvent>,
        /// Limit to these items: channel ids for channel events, task or
        /// document ids for task and document events. Omit to match every
        /// item; `*_created`, `channel.mentioned` and `email.message_received`
        /// usually omit it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ids: Option<Vec<Uuid>>,
        /// Optional yes/no question the triggering content must answer with
        /// yes, e.g. "Is this email from a customer?". Runs where the answer
        /// is no are skipped before any step runs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        condition: Option<String>,
    },
}

/// Activity that can trigger a routine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub enum RoutineEvent {
    /// New mail arrives in the owner's inbox (not spam, trash, drafts or imports).
    #[serde(rename = "email.message_received")]
    EmailMessageReceived,
    /// A task the owner can access is created.
    #[serde(rename = "task.created")]
    TaskCreated,
    /// A selected task's status changes.
    #[serde(rename = "task.status_changed")]
    TaskStatusChanged,
    /// A selected task's priority changes.
    #[serde(rename = "task.priority_changed")]
    TaskPriorityChanged,
    /// Any property of a selected task changes.
    #[serde(rename = "task.property_changed")]
    TaskPropertyChanged,
    /// A document the owner can access is created.
    #[serde(rename = "document.created")]
    DocumentCreated,
    /// A selected document is deleted.
    #[serde(rename = "document.deleted")]
    DocumentDeleted,
    /// A channel the owner can access is created.
    #[serde(rename = "channel.created")]
    ChannelCreated,
    /// Someone sends a message in a selected channel.
    #[serde(rename = "channel.message_posted")]
    ChannelMessagePosted,
    /// The owner is @-mentioned in a channel.
    #[serde(rename = "channel.mentioned")]
    ChannelMentioned,
    /// A call the owner can access starts.
    #[serde(rename = "call.started")]
    CallStarted,
    /// A call the owner can access ends.
    #[serde(rename = "call.ended")]
    CallEnded,
}

/// Bounds the scheduler enforces as well; checked here for clearer errors.
const MAX_TRIGGERS: usize = 16;
const MAX_EVENT_FILTERS: usize = 32;

/// Complete user-editable configuration, independent of execution bookkeeping.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineConfiguration {
    /// Short descriptive name.
    pub name: String,
    /// When it runs: one or more schedules and activity triggers.
    pub triggers: Vec<RoutineTrigger>,
    /// What it does each run, in order: a JSON array of steps, encoded as a
    /// string (see the tool description for the step format). Steps that
    /// decide about or read the triggering item (`if`, `choose`,
    /// `{{trigger.…}}`) need activity triggers only.
    #[serde(with = "steps_json")]
    #[schemars(with = "String")]
    pub steps: Vec<Step>,
    /// Apps its agent step needs, on top of the agent's own. The user must
    /// already have each one connected (offer a connect link via
    /// DiscoverConnectors if not). Updates replace the list: restate it to
    /// keep the apps.
    #[serde(default)]
    pub required_apps: Vec<RoutineApp>,
}
/// A Pipedream app a routine requires.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineApp {
    /// Pipedream app slug, e.g. `linear`.
    pub app_slug: String,
    /// Display name, e.g. `Linear`.
    pub name: String,
}

/// Steps travel as a JSON string so the tool's input schema stays flat: some
/// providers reject recursive or free-form schemas. An array is accepted too.
mod steps_json {
    use routine_program::Step;
    use serde::{Deserialize, Deserializer, Serializer, de::Error};
    use serde_json::Value;

    pub fn serialize<S: Serializer>(steps: &[Step], serializer: S) -> Result<S::Ok, S::Error> {
        let text = serde_json::to_string(steps).map_err(serde::ser::Error::custom)?;
        serializer.serialize_str(&text)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Step>, D::Error> {
        let value = match Value::deserialize(deserializer)? {
            Value::String(text) => serde_json::from_str(&text).map_err(|error| {
                D::Error::custom(format!("steps must be a JSON array of steps: {error}"))
            })?,
            value => value,
        };
        serde_json::from_value(value)
            .map_err(|error| D::Error::custom(format!("invalid steps: {error}")))
    }
}

impl RoutineConfiguration {
    /// Validate the user's intent independently of its transport representation.
    pub fn validate(&self, now: DateTime<Utc>) -> Result<()> {
        ensure!(!self.name.trim().is_empty(), "A routine name is required.");
        self.trigger(now)?;
        let summary = RoutineProgram::from_task(&self.task())
            .map_err(|error| anyhow::anyhow!("Invalid steps: {error}."))?
            .validate()
            .map_err(|error| anyhow::anyhow!("Invalid steps: {error}."))?;
        ensure!(
            !summary.needs_event()
                || self
                    .triggers
                    .iter()
                    .all(|trigger| matches!(trigger, RoutineTrigger::Event { .. })),
            "Steps that decide about or read the triggering item need activity triggers only."
        );
        Ok(())
    }

    /// The scheduler's task: the steps and the apps they require. The apps
    /// are always stated, so an update replaces them.
    pub fn task(&self) -> Value {
        let mcp_servers: Vec<Value> = self
            .required_apps
            .iter()
            .map(|app| serde_json::json!({ "app_slug": app.app_slug, "server_name": app.name }))
            .collect();
        serde_json::json!({ "steps": self.steps, "mcp_servers": mcp_servers })
    }

    /// The scheduler's trigger: schedules as they are, activity filters combined.
    pub fn trigger(&self, now: DateTime<Utc>) -> Result<Value> {
        ensure!(
            !self.triggers.is_empty(),
            "Add a trigger: a schedule or an activity event."
        );
        let mut schedules = Vec::new();
        let mut filters = Vec::new();
        for trigger in &self.triggers {
            match trigger {
                RoutineTrigger::Once { at } => {
                    schedules.push(cron_trigger(RoutineSchedule::Once { at: *at }.cron(now)?))
                }
                RoutineTrigger::Cron {
                    expression,
                    timezone,
                } => schedules.push(cron_trigger(
                    RoutineSchedule::Cron {
                        expression: expression.clone(),
                        timezone: timezone.clone(),
                    }
                    .cron(now)?,
                )),
                RoutineTrigger::Event {
                    events,
                    ids,
                    condition,
                } => {
                    ensure!(
                        !events.is_empty(),
                        "Activity triggers need at least one event."
                    );
                    let mut filter = serde_json::json!({ "events": events });
                    if let Some(ids) = ids {
                        filter["ids"] = serde_json::json!(ids);
                    }
                    if let Some(condition) = condition.as_deref().map(str::trim)
                        && !condition.is_empty()
                    {
                        filter["condition"] = condition.into();
                    }
                    filters.push(filter);
                }
            }
        }
        ensure!(
            schedules.len() + usize::from(!filters.is_empty()) <= MAX_TRIGGERS,
            "Use at most {MAX_TRIGGERS} schedules."
        );
        ensure!(
            filters.len() <= MAX_EVENT_FILTERS,
            "Use at most {MAX_EVENT_FILTERS} activity triggers."
        );
        if !filters.is_empty() {
            schedules.push(serde_json::json!({ "type": "events", "filters": filters }));
        }
        Ok(match <[Value; 1]>::try_from(schedules) {
            Ok([single]) => single,
            Err(triggers) => serde_json::json!({ "type": "multiple", "triggers": triggers }),
        })
    }
}

fn cron_trigger((schedule, timezone): (String, String)) -> Value {
    serde_json::json!({ "type": "cron", "schedule": schedule, "timezone": timezone })
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
/// A run started on demand; it continues after the call returns.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRunStarted {
    /// The routine that is running.
    pub routine_id: Uuid,
    /// The chat or agent session the run writes to, when the scheduler reports one.
    pub resource: Option<serde_json::Value>,
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
    /// Permanently delete an owned routine and its schedule.
    async fn delete(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<()>;
    /// Start an owned routine now, outside its schedule.
    async fn run_now(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<RoutineRunStarted>;
}
