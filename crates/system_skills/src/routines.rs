//! Agent-only skill: scheduling work for later with routines. How to call the
//! routine tools is in their descriptions.

use crate::{SystemSkill, Visibility};

/// The routines skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "routines",
    name: "Routines",
    description: "Use when the agent should do something later, on a schedule or whenever an event occurs: reminders, recurring reports, checking back on something; not a task with a due date or a meeting.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "CreateRoutine",
        "ListRoutines",
        "ReadRoutine",
        "UpdateRoutine",
        "RunRoutine",
        "DeleteRoutine",
    ],
    sdk_entities: &["routines"],
    instructions: include_str!("routines.md"),
};
