//! The routine catalog as clients offer it: each of Macro's routines with
//! its trigger in the owner's time zone, and its code step where code can be
//! saved.

use std::collections::BTreeMap;

use chrono_tz::Tz;
use routine_program::{CATALOG, CatalogRoutine, NamedItemKind, Step, Surface};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::event_trigger::ActionTrigger;
use super::ports::RoutineCode;

#[cfg(test)]
mod test;

/// One of Macro's routines, ready to start a new routine from.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    /// Names it, e.g. `inbox`.
    pub key: String,
    /// Where it is offered.
    pub surface: Surface,
    /// Its name once saved.
    pub title: String,
    /// What it does, in a short line.
    pub description: String,
    /// What someone asks for, with when it runs.
    pub request: String,
    /// What it does, in a few words, for the line beside its trigger.
    pub action: String,
    /// When it runs; schedules are in the zone the catalog was asked for.
    pub trigger: ActionTrigger,
    /// Its code step, in the shape a routine's task holds it; absent where
    /// code can't be saved, or when it is an Ask AI routine.
    #[schema(value_type = Option<routine_program::Step>)]
    pub code: Option<Value>,
    /// The code step's text knobs whose value names one of the owner's
    /// items (a tag, channel or label), by knob name.
    pub named_knobs: BTreeMap<String, NamedItemKind>,
    /// The Ask AI step's instructions: its only step without code, and the
    /// step to use where code can't be saved.
    pub instructions: String,
    /// It changes or sends what other people see.
    pub affects_others: bool,
    /// It may be switched on before its owner changes anything.
    pub safe_default: bool,
    /// Offered among the templates when someone creates a routine.
    pub template: bool,
}

/// Every catalog routine, with schedules in `timezone`. Code steps are left
/// out where code can't be saved.
pub fn catalog(code: &impl RoutineCode, timezone: Tz) -> Vec<CatalogEntry> {
    let code_available = code.sdk().is_some();
    CATALOG
        .iter()
        .filter_map(|routine| {
            entry(routine, timezone, code_available)
                .inspect_err(|error| {
                    tracing::error!(key = routine.key, error = %error, "catalog routine doesn't build");
                })
                .ok()
        })
        .collect()
}

/// `routine`'s trigger with `timezone` on its schedule.
pub fn trigger_in(routine: &CatalogRoutine, timezone: Tz) -> serde_json::Result<ActionTrigger> {
    let mut trigger = routine.trigger.clone();
    if let Value::Object(fields) = &mut trigger
        && fields.get("type").and_then(Value::as_str) == Some("cron")
    {
        fields.insert("timezone".into(), Value::String(timezone.name().to_owned()));
    }
    serde_json::from_value(trigger)
}

fn entry(
    routine: &CatalogRoutine,
    timezone: Tz,
    code_available: bool,
) -> serde_json::Result<CatalogEntry> {
    let code = match (&routine.code, code_available) {
        (Some(step), true) => Some(serde_json::to_value(Step::Code(step.clone()))?),
        _ => None,
    };
    Ok(CatalogEntry {
        key: routine.key.to_owned(),
        surface: routine.surface,
        title: routine.title.to_owned(),
        description: routine.description.to_owned(),
        request: routine.request.to_owned(),
        action: routine.action.to_owned(),
        trigger: trigger_in(routine, timezone)?,
        code,
        named_knobs: routine
            .named_knobs
            .iter()
            .map(|(name, item)| ((*name).to_owned(), *item))
            .collect(),
        instructions: routine.instructions.to_owned(),
        affects_others: routine.affects_others,
        safe_default: routine.safe_default,
        template: routine.template,
    })
}
