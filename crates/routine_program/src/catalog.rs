//! The routine catalog: Macro's checked routines, offered as templates when
//! someone creates a routine, shown to the routine drafter as worked
//! examples, and the only routines suggestions may pick from. The harness's
//! real-Deno tests type-check every code step against the SDK.

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::model::CodeStep;

#[cfg(test)]
mod test;

/// The part of the app a routine is about, where it is offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    /// Mail.
    Email,
    /// Meetings and the day ahead.
    Calendar,
    /// Tasks and projects.
    Tasks,
    /// Documents and files.
    Files,
    /// Companies, people and deals.
    Crm,
    /// Channels and messages.
    Chat,
    /// Calls and their transcripts.
    Calls,
    /// Pull requests and code review.
    Reviews,
    /// Agents and their sessions.
    Agents,
}

/// What a text knob's value names: one of its owner's items, which a client
/// matches by name or lets them pick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum NamedItemKind {
    /// A personal tag.
    Tag,
    /// A channel.
    Channel,
    /// An email label.
    Label,
}

/// A routine Macro offers: what it does, when it runs, and its step.
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogRoutine {
    /// Names it for clients and suggestions, e.g. `inbox`.
    pub key: &'static str,
    /// Where it is offered.
    pub surface: Surface,
    /// Its name once saved, e.g. "Sort my inbox".
    pub title: &'static str,
    /// What it does, in a short line.
    pub description: &'static str,
    /// What someone asks for, with when it runs, in their words.
    pub request: &'static str,
    /// What it does, in a few words, for the line beside its trigger.
    pub action: &'static str,
    /// When it runs, as the scheduler's trigger JSON. A cron schedule has no
    /// `timezone`: its times are the owner's, set when it is served.
    pub trigger: Value,
    /// The step that does it, where code can be saved. Saving gives it an id.
    pub code: Option<CodeStep>,
    /// The code step's text knobs whose value names one of the owner's
    /// items, by knob name.
    pub named_knobs: &'static [(&'static str, NamedItemKind)],
    /// The Ask AI step's instructions: its only step when it has no code,
    /// and what runs in place of the code where code can't be saved.
    pub instructions: &'static str,
    /// It changes or sends what other people see: messages, shared
    /// channels, items of theirs.
    pub affects_others: bool,
    /// It may be switched on before its owner changes anything, as a
    /// pre-selected suggestion. Only code that changes the owner's own items
    /// qualifies: an Ask AI step reads what arrives at run time and does
    /// what it decides, so an Ask AI routine never does.
    pub safe_default: bool,
    /// Offered among the templates when someone creates a routine; otherwise
    /// only the drafter and suggestions see it.
    pub template: bool,
}

/// Every catalog routine, in the order templates are offered.
pub static CATALOG: LazyLock<Vec<CatalogRoutine>> = LazyLock::new(|| {
    vec![
        CatalogRoutine {
            key: "inbox",
            surface: Surface::Email,
            title: "Sort my inbox",
            description: "AI labels new email by topic",
            request: "When a new email arrives, label it with the one of my labels that fits it best.",
            action: "Label with AI",
            trigger: events("email.message_received"),
            code: Some(code_step(
                "Label by topic",
                "Asks AI which of your labels fits each new email and adds it.",
                include_str!("catalog/inbox.ts"),
                json!([]),
                "Label each new email with the one of your labels that fits it best.",
            )),
            named_knobs: &[],
            instructions: "Label this email by topic with one of my existing labels. Leave it alone if none fits.",
            affects_others: false,
            safe_default: true,
            template: true,
        },
        CatalogRoutine {
            key: "triage",
            surface: Surface::Tasks,
            title: "Triage new tasks",
            description: "AI sets each new task\u{2019}s priority",
            request: "When a task is created, set its priority from what it says.",
            action: "Set priority with AI",
            trigger: events("task.created"),
            code: Some(code_step(
                "Set the priority",
                "Asks AI which priority fits each new task and sets it.",
                include_str!("catalog/triage.ts"),
                json!([]),
                "Set each new task's priority to the one that fits what it says.",
            )),
            named_knobs: &[],
            instructions: "Set this task\u{2019}s priority to Urgent, High, Medium or Low from what it says.",
            affects_others: false,
            safe_default: true,
            template: true,
        },
        CatalogRoutine {
            key: "brief",
            surface: Surface::Calendar,
            title: "Morning brief",
            description: "Weekdays at 9, sum up my day",
            request: "Every weekday at 9am, sum up my day: meetings, tasks due and anything waiting on me.",
            action: "Ask AI",
            trigger: cron("0 0 9 * * 2,3,4,5,6"),
            code: None,
            named_knobs: &[],
            instructions: "Summarize my day: today\u{2019}s meetings, tasks due today or overdue, and anything waiting on me. Link each item.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "updates",
            surface: Surface::Chat,
            title: "Share updates",
            description: "Post finished tasks to a channel",
            request: "When a task is marked completed, post \"Done: <task name>\" in the updates channel.",
            action: "Post in a channel",
            trigger: json!({
                "type": "events",
                "filters": [{
                    "events": ["task.status_changed"],
                    "condition": "Was the task just marked completed?",
                }],
            }),
            code: Some(code_step(
                "Post the update",
                "Posts the completed task's name in the updates channel.",
                include_str!("catalog/updates.ts"),
                json!([
                    { "type": "text", "name": "channel", "label": "Channel to post in", "value": "updates" },
                ]),
                "Post \u{201c}Done:\u{201d} and the task's name in {channel}.",
            )),
            named_knobs: &[("channel", NamedItemKind::Channel)],
            instructions: "Post \u{201c}Done:\u{201d} and this task\u{2019}s name in the updates channel.",
            affects_others: true,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "stuck",
            surface: Surface::Tasks,
            title: "Chase stuck tasks",
            description: "Fridays, list what\u{2019}s stalled",
            request: "Every Friday at 3pm, list my tasks that have been in progress or in review for over a week.",
            action: "Ask AI",
            trigger: cron("0 0 15 * * 6"),
            code: None,
            named_knobs: &[],
            instructions: "List my tasks that have been in progress or in review for more than a week, oldest first, with a suggested next step for each.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "email_tags",
            surface: Surface::Email,
            title: "Tag new email",
            description: "AI tags new email Reply, Followup, Action or FYI",
            request: "When a new email arrives, tag it Reply, Followup, Action or FYI, whichever fits.",
            action: "Tag with AI",
            trigger: events("email.message_received"),
            code: Some(code_step(
                "Tag by what it needs",
                "Asks AI whether each new email needs a reply, a follow-up, other work, or nothing, and adds that personal tag.",
                include_str!("catalog/email_tags.ts"),
                json!([
                    { "type": "text", "name": "replyTag", "label": "Tag for email waiting on a reply", "value": "Reply" },
                    { "type": "text", "name": "followupTag", "label": "Tag for email to follow up on", "value": "Followup" },
                    { "type": "text", "name": "actionTag", "label": "Tag for email asking for work", "value": "Action" },
                    { "type": "text", "name": "fyiTag", "label": "Tag for email with nothing to do", "value": "FYI" },
                ]),
                "Tag each new email {replyTag}, {followupTag}, {actionTag} or {fyiTag}, whichever fits.",
            )),
            named_knobs: &[
                ("replyTag", NamedItemKind::Tag),
                ("followupTag", NamedItemKind::Tag),
                ("actionTag", NamedItemKind::Tag),
                ("fyiTag", NamedItemKind::Tag),
            ],
            instructions: "Tag the email that just arrived with exactly one of my personal tags: Reply if the sender is waiting on a response, Followup to follow up later or wait on someone else, Action if it asks for work that is not a reply, FYI if there is nothing to do. Leave every other tag as it is. Do not send, archive, delete, or reply to the email.",
            affects_others: false,
            safe_default: true,
            template: true,
        },
        CatalogRoutine {
            key: "document_tags",
            surface: Surface::Files,
            title: "Tag new documents",
            description: "AI tags new documents by topic",
            request: "When I create a document, tag it with the one of my personal tags that fits it best.",
            action: "Tag with AI",
            trigger: events("document.created"),
            code: Some(code_step(
                "Tag by topic",
                "Asks AI which of your personal tags fits each new document and adds it.",
                include_str!("catalog/document_tags.ts"),
                json!([]),
                "Tag each new document with the one of your personal tags that fits it best.",
            )),
            named_knobs: &[],
            instructions: "Tag this new document with the one of my existing personal tags that fits its topic best. Leave it alone if none fits.",
            affects_others: false,
            safe_default: true,
            template: true,
        },
        CatalogRoutine {
            key: "call_tasks",
            surface: Surface::Calls,
            title: "Tasks from my calls",
            description: "After a call, make tasks for what I agreed to do",
            request: "When a call I joined ends, make a task for each thing I agreed to do.",
            action: "Ask AI",
            trigger: events("call.ended"),
            code: None,
            named_knobs: &[],
            instructions: "Read this call\u{2019}s transcript and make a task, assigned to me, for each thing I agreed to do, with a short description and a due date if one was said. Make no task for what others agreed to do.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "pipeline",
            surface: Surface::Crm,
            title: "Weekly pipeline review",
            description: "Mondays, list deals that need a next step",
            request: "Every Monday at 9am, list my CRM deals that have gone quiet, with a next step for each.",
            action: "Ask AI",
            trigger: cron("0 0 9 * * 2"),
            code: None,
            named_knobs: &[],
            instructions: "Review my CRM pipeline. List the deals and companies with no email, call or note in the last two weeks, most valuable first, with a suggested next step for each. Link each one.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "mentions",
            surface: Surface::Chat,
            title: "Catch up on mentions",
            description: "Weekdays at 5, sum up where I was mentioned",
            request: "Every weekday at 5pm, sum up the channel messages that mentioned me today and what they need from me.",
            action: "Ask AI",
            trigger: cron("0 0 17 * * 2,3,4,5,6"),
            code: None,
            named_knobs: &[],
            instructions: "Find today\u{2019}s channel messages that mention me. For each, say in a line what it needs from me, if anything, and link it. Put the ones waiting on me first.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "pull_requests",
            surface: Surface::Reviews,
            title: "Sum up new pull requests",
            description: "AI sums up each pull request opened in a repository",
            request: "When a pull request is opened in one of my repositories, sum up what it changes and what to look at first.",
            action: "Ask AI",
            trigger: json!({
                "type": "events",
                "filters": [{
                    "events": ["github"],
                    "github": { "events": ["pull_request"], "actions": ["opened"] },
                }],
            }),
            code: None,
            named_knobs: &[],
            instructions: "Sum up the pull request that was just opened: what it changes, why, and what a reviewer should look at first. Keep it short and link the pull request.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        CatalogRoutine {
            key: "agent_digest",
            surface: Surface::Agents,
            title: "Weekly agent digest",
            description: "Fridays, sum up what my agents did",
            request: "Every Friday at 4pm, sum up what my agents did this week and what's waiting on me.",
            action: "Ask AI",
            trigger: cron("0 0 16 * * 6"),
            code: None,
            named_knobs: &[],
            instructions: "Sum up what my agent sessions did this week: what each finished, what failed, and what is waiting on my answer. Link each session.",
            affects_others: false,
            safe_default: false,
            template: true,
        },
        // Offered to the drafter only, as the example of question knobs.
        CatalogRoutine {
            key: "invoices",
            surface: Surface::Email,
            title: "Task for invoices due soon",
            description: "AI makes a task to pay each invoice due soon",
            request: "When an invoice arrives that's due within a week, make a High priority task to pay it.",
            action: "Make a task with AI",
            trigger: events("email.message_received"),
            code: Some(code_step(
                "Task for invoices due soon",
                "Asks AI whether each new email is a bill due soon, and makes a task to pay it.",
                include_str!("catalog/invoices.ts"),
                json!([
                    { "type": "question", "name": "isInvoice", "label": "it's an invoice or bill to pay", "value": "Is this email an invoice or a bill that needs paying?" },
                    { "type": "number", "name": "dueWithinDays", "label": "Days until it's due", "value": 7, "min": 1, "max": 60 },
                    { "type": "choice", "name": "priority", "label": "Task priority", "value": "High", "options": ["Low", "Medium", "High", "Urgent"] },
                ]),
                "When {?isInvoice} and it's due within {dueWithinDays} days, make a task to pay it with {priority} priority.",
            )),
            named_knobs: &[],
            instructions: "If this email is an invoice or a bill due within a week, make a High priority task to pay it, due a day before the bill is.",
            affects_others: false,
            safe_default: false,
            template: false,
        },
    ]
});

/// The catalog routine `key` names.
pub fn catalog_routine(key: &str) -> Option<&'static CatalogRoutine> {
    CATALOG.iter().find(|routine| routine.key == key)
}

fn events(event: &str) -> Value {
    json!({ "type": "events", "filters": [{ "events": [event] }] })
}

fn cron(schedule: &str) -> Value {
    json!({ "type": "cron", "schedule": schedule })
}

fn code_step(title: &str, summary: &str, source: &str, knobs: Value, sentence: &str) -> CodeStep {
    CodeStep {
        id: None,
        title: title.to_owned(),
        summary: summary.to_owned(),
        source: source.to_owned(),
        knobs: serde_json::from_value(knobs).expect("a catalog routine's knobs are well formed"),
        sentence: Some(sentence.to_owned()),
    }
}
