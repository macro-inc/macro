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
    /// DiscoverConnectors if not). On update, omit it to keep the routine's
    /// current apps; a list replaces them, and an empty list removes them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_apps: Option<Vec<RoutineApp>>,
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

/// A configuration in the current shape, or in the single-agent shape callers
/// used before steps (`instructions`, `target`, `schedule`), which becomes one
/// agent step on that schedule. The advertised schema is the current one.
pub fn deserialize_configuration<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<RoutineConfiguration, D::Error> {
    use serde::de::Error;
    let mut value = Value::deserialize(deserializer)?;
    if let Value::Object(fields) = &mut value
        && !fields.contains_key("steps")
        && let Some(instructions) = fields.remove("instructions")
    {
        let mut agent = serde_json::json!({ "type": "agent", "instructions": instructions });
        if let Some(Value::Object(target)) = fields.remove("target") {
            match target.get("type").and_then(Value::as_str) {
                Some("model") => {
                    agent["model"] = target.get("model").cloned().unwrap_or(Value::Null);
                }
                Some("agent") => {
                    agent["agent"] = serde_json::json!({ "bot_id": target.get("agentId") });
                }
                _ => {}
            }
        }
        fields.insert("steps".into(), Value::Array(vec![agent]));
        if !fields.contains_key("triggers")
            && let Some(schedule) = fields.remove("schedule")
        {
            fields.insert("triggers".into(), Value::Array(vec![schedule]));
        }
    }
    RoutineConfiguration::deserialize(value).map_err(D::Error::custom)
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

/// A saved routine whose configuration these tools can't express without
/// losing part of it, so it is only edited on its page in Macro.
#[derive(Debug, Clone)]
pub struct NotEditableHere(String);

impl std::fmt::Display for NotEditableHere {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} Edit it on the routine's page in Macro.", self.0)
    }
}

impl std::error::Error for NotEditableHere {}

impl RoutineConfiguration {
    /// The saved routine in the shape CreateRoutine and UpdateRoutine take, so
    /// it can be sent back with only the intended change.
    pub fn from_saved(name: &str, trigger: &Value, task: &Value) -> Result<Self, NotEditableHere> {
        let program = RoutineProgram::from_task(task)
            .map_err(|_| NotEditableHere("Its steps can't be read here.".into()))?;
        Ok(Self {
            name: name.to_owned(),
            triggers: saved_triggers(trigger)?,
            steps: program.steps,
            required_apps: Some(
                program
                    .mcp_servers
                    .into_iter()
                    .map(|app| RoutineApp {
                        app_slug: app.app_slug,
                        name: app.server_name,
                    })
                    .collect(),
            ),
        })
    }

    /// Validate the user's intent independently of its transport representation.
    pub fn validate(&self, now: DateTime<Utc>) -> Result<()> {
        ensure!(!self.name.trim().is_empty(), "A routine name is required.");
        self.trigger(now)?;
        // Validate as a program, so a lone agent step gets every check too.
        let apps: Vec<Value> = self
            .required_apps
            .iter()
            .flatten()
            .map(|app| serde_json::json!({ "app_slug": app.app_slug, "server_name": app.name }))
            .collect();
        let program = serde_json::json!({ "steps": self.steps, "mcp_servers": apps });
        let summary = RoutineProgram::from_task(&program)
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

    /// The scheduler's task, replacing `saved` when updating. Apps are always
    /// stated: the listed ones, or the saved ones when the caller omitted them.
    /// A lone agent step is stored as the single agent task routines had
    /// before steps, as the app does, so every scheduler version can run it;
    /// a saved program stays a program.
    pub fn task(&self, saved: Option<&Value>) -> Value {
        let mcp_servers: Vec<Value> = match &self.required_apps {
            Some(apps) => apps
                .iter()
                .map(|app| serde_json::json!({ "app_slug": app.app_slug, "server_name": app.name }))
                .collect(),
            None => saved
                .and_then(|task| task.get("mcp_servers"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        };
        let saved_program = saved.is_some_and(|task| task.get("steps").is_some());
        if !saved_program && let [Step::Agent(agent)] = self.steps.as_slice() {
            let (prompt, user_prompt) = split_instructions(saved, &agent.instructions);
            let mut task = serde_json::json!({
                "mcp_servers": mcp_servers,
                "prompt": prompt,
                "user_prompt": user_prompt,
            });
            if let Some(model) = &agent.model {
                task["model"] = model.clone().into();
            }
            if let Some(selection) = &agent.agent {
                task["agent"] = serde_json::json!({ "bot_id": selection.bot_id });
            }
            return task;
        }
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

/// The saved scheduler trigger as these tools' triggers: schedules stay cron
/// expressions; each activity filter becomes one event trigger.
fn saved_triggers(trigger: &Value) -> Result<Vec<RoutineTrigger>, NotEditableHere> {
    let unreadable = || NotEditableHere("Its triggers can't be read here.".into());
    match trigger.get("type").and_then(Value::as_str) {
        Some("cron") => Ok(vec![RoutineTrigger::Cron {
            expression: string_field(trigger, "schedule").ok_or_else(unreadable)?,
            timezone: string_field(trigger, "timezone").ok_or_else(unreadable)?,
        }]),
        Some("events") => trigger
            .get("filters")
            .and_then(Value::as_array)
            .ok_or_else(unreadable)?
            .iter()
            .map(saved_filter)
            .collect(),
        Some("multiple") => {
            let mut triggers = Vec::new();
            for trigger in trigger
                .get("triggers")
                .and_then(Value::as_array)
                .ok_or_else(unreadable)?
            {
                triggers.extend(saved_triggers(trigger)?);
            }
            Ok(triggers)
        }
        _ => Err(unreadable()),
    }
}

/// One activity filter, refused when it holds what an event trigger here
/// can't state (GitHub selectors, payload tests, older event kinds), since
/// sending it back would drop them.
fn saved_filter(filter: &Value) -> Result<RoutineTrigger, NotEditableHere> {
    let Value::Object(fields) = filter else {
        return Err(NotEditableHere("Its triggers can't be read here.".into()));
    };
    if let Some(key) = fields
        .keys()
        .find(|key| !matches!(key.as_str(), "events" | "ids" | "condition"))
    {
        return Err(NotEditableHere(match key.as_str() {
            "github" | "match" => {
                "It has GitHub or payload filters these tools can't state.".into()
            }
            _ => format!("Its trigger has a `{key}` setting these tools can't state."),
        }));
    }
    let events: Vec<RoutineEvent> = serde_json::from_value(fields["events"].clone())
        .map_err(|_| NotEditableHere("It uses events these tools can't state.".into()))?;
    let ids = match fields.get("ids") {
        None | Some(Value::Null) => None,
        Some(ids) => Some(
            serde_json::from_value(ids.clone())
                .map_err(|_| NotEditableHere("Its trigger's items can't be read here.".into()))?,
        ),
    };
    Ok(RoutineTrigger::Event {
        events,
        ids,
        condition: fields
            .get("condition")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
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
    /// The saved configuration in the shape CreateRoutine and UpdateRoutine
    /// take. To change it, send it back with only the intended change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configuration: Option<RoutineConfiguration>,
    /// Why `configuration` is absent: part of this routine can only be
    /// edited on its page in Macro, so UpdateRoutine refuses to replace it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_editable_here: Option<String>,
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

/// A saved single agent task keeps its routine instructions (`prompt`) apart
/// from the user task, and reads back as the two joined by a blank line. While
/// the joined text still starts with the saved instructions, keep them apart,
/// so the agent is told them the same way as before the edit.
fn split_instructions(saved: Option<&Value>, instructions: &str) -> (String, String) {
    let base = saved
        .and_then(|task| task.get("prompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    match instructions
        .strip_prefix(base)
        .and_then(|rest| rest.strip_prefix("\n\n"))
    {
        Some(user_prompt) if !base.is_empty() => (base.to_owned(), user_prompt.to_owned()),
        _ => (String::new(), instructions.to_owned()),
    }
}
