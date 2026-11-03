//! Agent-only skill: creating and organizing tasks and initiatives. How to
//! call the task SDK is in its TSDoc.

use crate::{SystemSkill, Visibility};

/// The tasks skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "tasks",
    name: "Tasks",
    description: "Use when creating, assigning or updating tasks or initiatives, or reporting on tasks such as open or overdue ones.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "ListInitiatives",
        "ReadInitiative",
        "CreateInitiative",
        "UpdateInitiative",
    ],
    sdk_entities: &["tasks", "initiatives"],
    instructions: include_str!("tasks.md"),
};
