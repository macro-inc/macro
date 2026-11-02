//! Starter routines whose step is code: offered when someone creates a
//! routine, and shown to the routine drafter as worked examples. The
//! harness's real-Deno tests type-check every one against the SDK.

use std::sync::LazyLock;

use crate::model::{CodeStep, WriteScope};

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
            WriteScope::Email,
            include_str!("starters/inbox.ts"),
        ),
        starter(
            "triage",
            "When a task is created, set its priority from what it says.",
            "Set the priority",
            "Asks AI which priority fits each new task and sets it.",
            WriteScope::Properties,
            include_str!("starters/triage.ts"),
        ),
        starter(
            "updates",
            "When a task is marked completed, post \"Done: <task name>\" in the updates channel.",
            "Post the update",
            "Posts the completed task's name in the updates channel.",
            WriteScope::Workspace,
            include_str!("starters/updates.ts"),
        ),
    ]
});

fn starter(
    key: &'static str,
    request: &'static str,
    title: &str,
    summary: &str,
    writes: WriteScope,
    source: &str,
) -> Starter {
    Starter {
        key,
        request,
        step: CodeStep {
            id: None,
            title: title.to_owned(),
            summary: summary.to_owned(),
            source: source.to_owned(),
            writes: vec![writes],
        },
    }
}
