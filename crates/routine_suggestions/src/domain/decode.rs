//! The lenient shape the model answers in, and its validation into
//! [`RoutineSuggestion`]s.
//!
//! Every field the model fills is a plain string, checked here rather than in
//! the JSON schema: one malformed suggestion is dropped instead of failing the
//! whole generation.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use schemars::JsonSchema;
use serde::Deserialize;

use super::model::{
    ClockTime, RoutineSuggestion, RoutineSurface, SuggestedEvent, SuggestionIcon,
    SuggestionSchedule, SuggestionTrigger, Weekday,
};

#[cfg(test)]
mod test;

/// Suggestions kept for each surface; the modal shows them all, the sidebar
/// card teases the first.
pub const SUGGESTIONS_PER_SURFACE: usize = 3;

/// Longest condition the routine composer accepts, in characters.
pub const MAX_CONDITION_CHARS: usize = 500;

/// The model's answer.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(description = "Routine suggestions for one user")]
pub struct RawSuggestions {
    /// Up to 3 suggestions for each surface, best first
    // Decoded one at a time, so a malformed item drops only itself.
    #[schemars(with = "Vec<RawSuggestion>")]
    pub suggestions: Vec<serde_json::Value>,
}

/// One suggestion as the model writes it.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RawSuggestion {
    /// Exactly one of: email, calendar, tasks, files, crm, chat, calls, reviews, agents
    pub surface: String,
    /// Short imperative routine name, at most 6 words, e.g. "Tag invoices and receipts"
    pub title: String,
    /// One plain sentence on what the routine does, at most 20 words
    pub summary: String,
    /// Why this fits this user specifically, grounded in what you saw in their inbox, at most 12 words, no trailing period
    pub reason: String,
    /// The complete instructions the routine agent follows on every run, written to the agent in the second person. Concrete and specific to this user: name the real senders, companies, labels, or topics you found. 2-6 sentences.
    pub instructions: String,
    /// Exactly one of: mail, tag, bell, calendar, task, document, chart, people, phone, code, chat, sparkle
    pub icon: String,
    /// Your calibrated estimate, from 0 to 1, that this user would still have this routine turned on a month after it was turned on for them without asking. See the calibration rules in the instructions.
    pub keep_probability: f64,
    /// True when the routine sends or posts anything, shares anything, or changes records other people see (shared CRM records, shared documents, tasks assigned to others); false when it only labels, summarizes, drafts, or changes things only the user sees
    pub affects_others: bool,
    /// True when the user should see every run in Home (alerts, digests, briefings); false for silent background upkeep
    pub notify: bool,
    /// When the routine runs
    pub trigger: RawTrigger,
}

/// When a suggestion runs, as the model writes it.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RawTrigger {
    /// "event" or "schedule"
    pub kind: String,
    /// For kind "event": exactly one of email.message_received, task.created, document.created, call.started, call.ended
    #[serde(default)]
    pub event: Option<String>,
    /// For kind "event": optional yes/no question the event must answer yes to before the routine runs, e.g. "Is this email an invoice or a receipt?"
    #[serde(default)]
    pub condition: Option<String>,
    /// For kind "schedule": "hour", "day", "week", or "month"
    #[serde(default)]
    pub frequency: Option<String>,
    /// For kind "schedule": 24-hour local time "HH:MM"
    #[serde(default)]
    pub time: Option<String>,
    /// For frequency "week": the days to run, from sun, mon, tue, wed, thu, fri, sat
    #[serde(default)]
    pub weekdays: Option<Vec<String>>,
    /// For frequency "month": the day to run, 1-28
    #[serde(default)]
    pub day_of_month: Option<i64>,
}

/// The JSON schema the model answers in.
pub fn response_schema() -> serde_json::Value {
    schemars::schema_for!(RawSuggestions).to_value()
}

/// The usable suggestions in the model's answer: at most
/// [`SUGGESTIONS_PER_SURFACE`] per surface, none repeated (same surface and
/// title), in the model's order. Suggestions with an unknown surface or
/// trigger, empty title or instructions, or an over-long condition are
/// dropped.
pub fn decode_suggestions(raw: RawSuggestions) -> Vec<RoutineSuggestion> {
    let mut per_surface: HashMap<RoutineSurface, usize> = HashMap::new();
    let mut seen: HashSet<(RoutineSurface, String)> = HashSet::new();
    raw.suggestions
        .into_iter()
        .filter_map(|value| serde_json::from_value::<RawSuggestion>(value).ok())
        .filter_map(decode_suggestion)
        .filter(|suggestion| {
            let count = per_surface.entry(suggestion.surface).or_default();
            if *count >= SUGGESTIONS_PER_SURFACE
                || !seen.insert((suggestion.surface, suggestion.title.to_lowercase()))
            {
                return false;
            }
            *count += 1;
            true
        })
        .collect()
}

fn decode_suggestion(raw: RawSuggestion) -> Option<RoutineSuggestion> {
    let surface = RoutineSurface::from_str(raw.surface.trim()).ok()?;
    let title = raw.title.trim();
    let instructions = raw.instructions.trim();
    if title.is_empty() || instructions.is_empty() {
        return None;
    }
    Some(RoutineSuggestion {
        surface,
        title: title.to_owned(),
        summary: raw.summary.trim().to_owned(),
        reason: raw.reason.trim().to_owned(),
        instructions: instructions.to_owned(),
        icon: SuggestionIcon::from_str(raw.icon.trim()).unwrap_or(SuggestionIcon::Sparkle),
        keep_probability: if raw.keep_probability.is_finite() {
            raw.keep_probability.clamp(0.0, 1.0)
        } else {
            0.0
        },
        affects_others: raw.affects_others,
        notify: raw.notify,
        trigger: decode_trigger(raw.trigger)?,
    })
}

fn decode_trigger(raw: RawTrigger) -> Option<SuggestionTrigger> {
    match raw.kind.trim() {
        "event" => {
            let event = SuggestedEvent::from_str(raw.event?.trim()).ok()?;
            let condition = raw
                .condition
                .map(|condition| condition.trim().to_owned())
                .filter(|condition| !condition.is_empty());
            // The condition narrows what the routine runs on; without it the
            // routine would run on every event, so an unusable one drops the
            // suggestion rather than the condition.
            if condition
                .as_ref()
                .is_some_and(|condition| condition.chars().count() > MAX_CONDITION_CHARS)
            {
                return None;
            }
            Some(SuggestionTrigger::Event { event, condition })
        }
        "schedule" => Some(SuggestionTrigger::Schedule {
            schedule: decode_schedule(&raw)?,
        }),
        _ => None,
    }
}

fn decode_schedule(raw: &RawTrigger) -> Option<SuggestionSchedule> {
    let frequency = raw.frequency.as_deref()?.trim();
    if frequency == "hour" {
        return Some(SuggestionSchedule::Hour);
    }
    let time = ClockTime::try_from(raw.time.as_deref()?.trim().to_owned()).ok()?;
    match frequency {
        "day" => Some(SuggestionSchedule::Day { time }),
        "week" => {
            let mut weekdays: Vec<Weekday> = Vec::new();
            for day in raw.weekdays.as_deref()? {
                let day = Weekday::from_str(day.trim()).ok()?;
                if !weekdays.contains(&day) {
                    weekdays.push(day);
                }
            }
            (!weekdays.is_empty()).then_some(SuggestionSchedule::Week { time, weekdays })
        }
        "month" => {
            let day_of_month = u8::try_from(raw.day_of_month.unwrap_or(1)).ok()?;
            (1..=28)
                .contains(&day_of_month)
                .then_some(SuggestionSchedule::Month { time, day_of_month })
        }
        _ => None,
    }
}
