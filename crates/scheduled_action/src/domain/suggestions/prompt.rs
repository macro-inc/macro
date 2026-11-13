//! What a suggestion session is told: the brief, with the person's mail
//! and apps as untrusted data.

use chrono::{SecondsFormat, Utc};
use routine_program::{CATALOG, CODE_STEPS, CatalogRoutine, STEP_CONTEXT, Surface};
use serde_json::{Value, json};

use super::decode::line;
use super::ports::InboxMessage;
use crate::domain::drafts::FILTER_ITEMS;

#[cfg(test)]
mod test;

/// The task, before the data.
const TASK: &str = include_str!("prompt.md");

/// Longest subject passed on, in characters.
const MAX_SUBJECT_CHARS: usize = 200;
/// Longest snippet passed on, in characters.
pub const MAX_SNIPPET_CHARS: usize = 500;
/// Longest address, label or name passed on, in characters.
const MAX_NAME_CHARS: usize = 120;
/// Most recipients and labels passed on per message.
const MAX_LIST: usize = 5;

/// Everything a suggestion session reads about the person.
#[derive(Debug, Clone, PartialEq)]
pub struct BriefData<'a> {
    /// The surfaces this session suggests for.
    pub surfaces: &'a [Surface],
    pub inbox: &'a [InboxMessage],
    /// Apps the person connected, by slug.
    pub apps: &'a [String],
    /// What the person dismissed or already suggested: catalog keys and
    /// routine names.
    pub dismissed: &'a [String],
    /// IANA zone schedules are written in.
    pub timezone: &'a str,
    /// The model an Ask AI step runs on.
    pub agent_model: &'a str,
    /// Whether code steps can be written.
    pub code: bool,
    /// How to write a routine: `routine_program::ROUTINE_RULES`. The brief adds
    /// the code-step contract when code steps can be written.
    pub guide: &'a str,
}

/// The session's one prompt.
pub fn brief(data: &BriefData<'_>) -> String {
    let surfaces = data
        .surfaces
        .iter()
        .filter_map(|surface| serde_json::to_value(surface).ok())
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect::<Vec<_>>()
        .join(", ");
    let task = TASK.replace("{surfaces}", &surfaces);
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let model = data.agent_model;
    let timezone = data.timezone;
    let steps = if data.code {
        format!(
            "An Ask AI step is `{{type: 'agent', model: '{model}', instructions}}`.\n\n{CODE_STEPS}\nThe type of `main`'s argument:\n```ts\n{STEP_CONTEXT}```"
        )
    } else {
        format!(
            "Code steps can't be used: a routine you write has one Ask AI step ({{type: 'agent', model: '{model}', instructions}})."
        )
    };
    let catalog: Vec<Value> = CATALOG
        .iter()
        .filter(|routine| routine.surfaces.iter().any(|s| data.surfaces.contains(s)))
        .map(catalog_entry)
        .collect();
    let inbox: Vec<Value> = data.inbox.iter().map(message).collect();
    let apps: Vec<String> = data
        .apps
        .iter()
        .filter_map(|app| line(app, MAX_NAME_CHARS))
        .collect();
    let guide = data.guide.trim();
    format!(
        "{task}
Now is {now}; the user's time zone is {timezone}. Cron schedules take `timezone: '{timezone}'`.

<writing-routines>
{guide}
</writing-routines>
{FILTER_ITEMS}

{steps}

Macro's catalog, for your surfaces (written by Macro):
{catalog}

Already suggested or dismissed, never to suggest again (catalog keys and routine names):
{dismissed}

The user's connected apps:
<untrusted>
{apps}
</untrusted>

The user's newest mail, newest first:
<untrusted>
{inbox}
</untrusted>",
        catalog = Value::Array(catalog),
        dismissed = json!(data.dismissed),
        apps = json!(apps),
        inbox = Value::Array(inbox),
    )
}

fn catalog_entry(routine: &CatalogRoutine) -> Value {
    let knobs: Vec<Value> = routine
        .code
        .iter()
        .flat_map(|code| code.knobs.iter())
        .filter_map(|knob| serde_json::to_value(knob).ok())
        .collect();
    json!({
        "key": routine.key,
        "surfaces": routine.surfaces,
        "title": routine.title,
        "does": routine.request,
        "knobs": knobs,
        "safeByDefault": routine.safe_default,
    })
}

/// A message as the session reads it: trimmed, bounded fields.
fn message(message: &InboxMessage) -> Value {
    let bounded =
        |text: &Option<String>, max: usize| text.as_deref().map(|text| truncate(text, max));
    let list = |items: &[String]| -> Vec<String> {
        items
            .iter()
            .take(MAX_LIST)
            .map(|item| truncate(item, MAX_NAME_CHARS))
            .collect()
    };
    json!({
        "from": bounded(&message.from, MAX_NAME_CHARS),
        "to": list(&message.to),
        "date": message.received_at.map(|at| at.to_rfc3339_opts(SecondsFormat::Secs, true)),
        "subject": bounded(&message.subject, MAX_SUBJECT_CHARS),
        "labels": list(&message.labels),
        "snippet": bounded(&message.snippet, MAX_SNIPPET_CHARS),
    })
}

/// `text` on one line, cut to `max` characters, with control and
/// formatting characters dropped and angle brackets swapped for look-alikes,
/// so it can't close its tag.
fn truncate(text: &str, max: usize) -> String {
    text.chars()
        .map(|c| match c {
            '<' => '\u{2039}',
            '>' => '\u{203A}',
            c if c.is_control() => ' ',
            c => c,
        })
        .filter(|c| !matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}'))
        .take(max)
        .collect()
}
