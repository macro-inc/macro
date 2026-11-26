//! What a suggestion session is told: the brief, with the person's mail
//! and apps as untrusted data.

use chrono::{SecondsFormat, Utc};
use routine_program::{CATALOG, CODE_STEPS, CatalogRoutine, STEP_CONTEXT, Surface};
use serde_json::{Value, json};

use suggestions::domain::model::GenerationTrigger;

use super::decode::line;
use super::ports::{BriefPart, InboxMessage};
use super::work::WORK_DAYS;

#[cfg(test)]
mod test;

/// The task, before the data: a frame its part's plan and kinds of
/// suggestion fill in.
const TASK: &str = include_str!("prompt.md");
/// How a session that both picks and drafts works.
const WHOLE: &str = include_str!("prompt/whole.md");
/// How a session that only picks works.
const PICKS: &str = include_str!("prompt/picks.md");
/// How a session that only drafts works, from the streams of work found in
/// the person's month of mail.
const DRAFTS: &str = include_str!("prompt/drafts.md");
/// How it works when no streams were found: from the newest mail alone.
const DRAFTS_FROM_MAIL: &str = include_str!("prompt/drafts_from_mail.md");
/// A catalog pick, as a session hands it back.
const CATALOG_KIND: &str = include_str!("prompt/catalog.md");
/// A drafted routine, likewise.
const DRAFTED_KIND: &str = include_str!("prompt/drafted.md");
/// When a catalog routine handles a stream.
const HANDLES: &str = "A catalog routine handles a stream when its condition holds for that \
    stream's messages and what it makes is all the user needs, even when it is broader \
    than the stream (one that makes a task for every email asking them for work handles \
    each kind of request)";
/// The streams the catalog lacks.
const LACKS: &str = "The catalog lacks a stream whose work is more than a task for each \
    request: notices that ask nothing outright but leave them a step to take, which no \
    routine for requests or for mail awaiting their answer catches; messages that add up \
    to one thing they keep track of (amounts, counts or statuses gathered across many \
    messages and senders); and messages that bring them a company that may become a \
    client, or an entry for a log they keep.";
/// How many suggestions to expect, told to a session that picks.
const COUNT: &str = " Most users get 3 to 6 suggestions in all, and leaving a part of the \
    app without any is often right.";
/// Likewise, to a session that only drafts: as many as the streams need.
const COUNT_DRAFTS: &str = " Leaving a part of the app without any is often right.";
/// Who a drafted routine is for, in a whole session and one that drafts from
/// the newest mail: work that comes every week.
const WEEKLY_STREAM: &str = "for a stream they act on every week";
/// Likewise, drafting from the streams found in a month: the list says how
/// often each comes, and a monthly one is work too.
const LISTED_STREAM: &str = "for a stream on the list";
/// Most routines a session that only drafts is told to draft.
pub const MAX_DRAFTS: usize = 8;

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
    /// What started the generation.
    pub trigger: GenerationTrigger,
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
    /// Whether a routine may start when mail arrives: the person is in the
    /// event routines rollout and the deployment evaluates conditions.
    pub events: bool,
    /// Whether the person may add companies to a team's CRM, which a drafted
    /// routine for possible clients does.
    pub crm: bool,
    /// The SDK's routines guide.
    pub guide: &'a str,
    /// The part of the work the session does.
    pub part: BriefPart<'a>,
}

/// How a drafted routine starts when the person may have event triggers.
const START_ON_MAIL: &str = "start it when that kind of mail arrives \
    (`email.message_received`, with a condition that names it) and handle what each \
    message asks of them, or run it on a schedule that gathers that week's mail of that \
    kind into one task or document for them";

/// How a drafted routine starts when they may not: a check would refuse an
/// event trigger.
const START_ON_SCHEDULE: &str = "this user's routines can't start when mail \
    arrives, so run it on a schedule: each morning, to handle what each message of that \
    kind since the last run asks of them, or each week, to gather that week's mail of \
    that kind into one task or document for them";

/// What a drafted routine makes for a possible client, told only to a person
/// who may add companies to a team's CRM: for anyone else the tool refuses,
/// and a task for each step serves.
const CRM_COMPANY: &str = "a company in their CRM for a company that may become a \
    client (unless another app of theirs already keeps track of them), ";

/// What a weekly routines session does before suggesting: review and retire.
const WEEKLY_REVIEW: &str = "Where this differs from the rest of the brief, \
    this wins. First, in one \
    program, read what you suggested before with \
    `await macro.routines.review()` and the user's own routines with \
    `await macro.routines.list()`, and retire with `suggestion.retire(reason)` open \
    suggestions that no longer fit their work or duplicate one of their routines. Then \
    suggest at most 2 new routines in all, and none unless the \
    evidence is strong. Draft at most one routine the catalog lacks, and only one built \
    around something specific in their workspace that you name (a deal, vendor, \
    project, channel, label or report they keep), that discovers, evaluates or advances \
    it; a general habit is a catalog routine or nothing. Never a weekly recap, digest or \
    audit, and never what their own routines already do. When you draft nothing, don't \
    read the routine-writing docs. Suggestions are never rewritten; retire one and \
    suggest a better one instead.";

/// The session's one prompt.
pub fn brief(data: &BriefData<'_>) -> String {
    let surfaces = data
        .surfaces
        .iter()
        .filter_map(|surface| serde_json::to_value(surface).ok())
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect::<Vec<_>>()
        .join(", ");
    let occasion = match data.trigger {
        GenerationTrigger::Onboarding => {
            "The user just signed up. Be quick: they are waiting. At signup their mail \
             is what shows their work, so work from the mail below: don't search or \
             list anything in their workspace."
                .to_owned()
        }
        GenerationTrigger::Nightly => format!(
            "This is the week's run (routine suggestions come once a week). {WEEKLY_REVIEW}"
        ),
        GenerationTrigger::Manual => format!(
            "The user asked for fresh suggestions; this is the week's run (routine \
             suggestions come once a week). {WEEKLY_REVIEW}"
        ),
    };
    let (plan, kinds, count) = match data.part {
        BriefPart::Whole => (
            WHOLE,
            format!(
                "1. {}\n2. {}",
                CATALOG_KIND.trim_end(),
                DRAFTED_KIND.trim_end()
            ),
            COUNT,
        ),
        // Nothing else is suggested, so no kind is preferred.
        BriefPart::Picks => (
            PICKS,
            CATALOG_KIND.trim_end().replace(" Prefer these.", ""),
            COUNT,
        ),
        BriefPart::Drafts(Some(_)) => (
            DRAFTS,
            DRAFTED_KIND
                .trim_end()
                .replace(WEEKLY_STREAM, LISTED_STREAM),
            COUNT_DRAFTS,
        ),
        BriefPart::Drafts(None) => (
            DRAFTS_FROM_MAIL,
            DRAFTED_KIND.trim_end().to_owned(),
            COUNT_DRAFTS,
        ),
    };
    let plan = plan
        .trim_end()
        .replace("{handles}", HANDLES)
        .replace("{lacks}", LACKS)
        .replace("{max_drafts}", &MAX_DRAFTS.to_string())
        .replace("{days}", &WORK_DAYS.to_string());
    let task = TASK
        .replace("{count}", count)
        .replace("{plan}", &plan)
        .replace("{kinds}", &kinds)
        .replace("{surfaces}", &surfaces)
        .replace("{occasion}", &occasion)
        .replace("{crm}", if data.crm { CRM_COMPANY } else { "" })
        .replace(
            "{start}",
            if data.events {
                START_ON_MAIL
            } else {
                START_ON_SCHEDULE
            },
        );
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let model = data.agent_model;
    let timezone = data.timezone;
    let steps = if data.code {
        format!(
            "Steps run in order. Prefer a code step whenever code can do the job. An Ask AI step ({{type: 'agent', model: '{model}', instructions}}) hands open-ended work to AI with tools; a routine has at most one, last.\n\nHow to write a code step:\n{CODE_STEPS}\n\nThe type of `main`'s argument:\n```ts\n{STEP_CONTEXT}```"
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
    // A session that only picks writes no routine: it reads neither the
    // guide nor how steps are written.
    let writing = match data.part {
        BriefPart::Picks => String::new(),
        BriefPart::Whole | BriefPart::Drafts(_) => format!(
            "
<routines-guide>
{guide}
</routines-guide>

{steps}
"
        ),
    };
    let work = match data.part {
        BriefPart::Drafts(Some(list)) => format!(
            "

The streams of work a step found in the user's last {WORK_DAYS} days of mail, those they would most regret missing first:
<untrusted>

```json
{}
```

</untrusted>",
            list.to_brief()
        ),
        BriefPart::Whole | BriefPart::Picks | BriefPart::Drafts(None) => String::new(),
    };
    format!(
        "{task}
Now is {now}; the user's time zone is {timezone}. Cron schedules take `timezone: '{timezone}'`.
{writing}
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
</untrusted>{work}",
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
pub(super) fn truncate(text: &str, max: usize) -> String {
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
