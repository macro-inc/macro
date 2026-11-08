//! Starter routines whose step is code: offered when someone creates a
//! routine, and shown to the routine drafter as worked examples. The
//! harness's real-Deno tests type-check every one against the SDK.

use std::sync::LazyLock;

use serde_json::json;

use crate::model::CodeStep;

#[cfg(test)]
mod test;

/// A starter routine: what someone asks for, and the code step that does it.
#[derive(Debug, Clone, PartialEq)]
pub struct Starter {
    /// Names it for the client that offers it, e.g. `inbox`.
    pub key: &'static str,
    /// What someone asks for, with when it runs, in their words.
    pub request: &'static str,
    /// The step that does it. Saving gives it an id.
    pub step: CodeStep,
}

/// Every starter routine.
pub static STARTERS: LazyLock<Vec<Starter>> = LazyLock::new(|| {
    vec![
        starter(
            "inbox",
            "When a new email arrives, label it with the one of my labels that fits it best.",
            "Label by topic",
            "Asks AI which of your labels fits each new email and adds it.",
            include_str!("starters/inbox.ts"),
            json!([]),
            "Label each new email with the one of your labels that fits it best.",
        ),
        starter(
            "triage",
            "When a task is created, set its priority from what it says.",
            "Set the priority",
            "Asks AI which priority fits each new task and sets it.",
            include_str!("starters/triage.ts"),
            json!([]),
            "Set each new task's priority to the one that fits what it says.",
        ),
        starter(
            "updates",
            "When a task is marked completed, post \"Done: <task name>\" in a channel.",
            "Post the update",
            "Posts the completed task's name in the channel picked.",
            include_str!("starters/updates.ts"),
            json!([
                { "type": "entity", "name": "channel", "label": "Channel to post in", "entity_types": ["channel"], "value": null },
            ]),
            "Post \u{201c}Done:\u{201d} and the task's name in {channel}.",
        ),
        // Offered to the drafter only, as the example of question knobs.
        starter(
            "invoices",
            "When an invoice arrives that's due within a week, make a High priority task to pay it.",
            "Task for invoices due soon",
            "Asks AI whether each new email is a bill due soon, and makes a task to pay it.",
            include_str!("starters/invoices.ts"),
            json!([
                { "type": "question", "name": "isInvoice", "label": "it's an invoice or bill to pay", "value": "Is this email an invoice or a bill that needs paying?" },
                { "type": "number", "name": "dueWithinDays", "label": "Days until it's due", "value": 7, "min": 1, "max": 60 },
                { "type": "choice", "name": "priority", "label": "Task priority", "value": "High", "options": ["Low", "Medium", "High", "Urgent"] },
            ]),
            "When {?isInvoice} and it's due within {dueWithinDays} days, make a task to pay it with {priority} priority.",
        ),
    ]
});

#[allow(clippy::too_many_arguments)]
fn starter(
    key: &'static str,
    request: &'static str,
    title: &str,
    summary: &str,
    source: &str,
    knobs: serde_json::Value,
    sentence: &str,
) -> Starter {
    Starter {
        key,
        request,
        step: CodeStep {
            id: None,
            title: title.to_owned(),
            summary: summary.to_owned(),
            source: source.to_owned(),
            knobs: serde_json::from_value(knobs).expect("a starter's knobs are well formed"),
            sentence: Some(sentence.to_owned()),
        },
    }
}
