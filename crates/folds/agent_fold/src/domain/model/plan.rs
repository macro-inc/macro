//! The agent's plan: a todo list carried whole on every update.

use serde::Serialize;
use specta::Type;

/// One task on an agent plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    /// What this task aims to accomplish.
    pub content: String,
    /// The task's relative importance.
    pub priority: PlanEntryPriority,
    /// Where the task got to.
    pub status: PlanEntryStatus,
}

/// A [`PlanEntry`]'s relative importance, mirroring ACP's
/// `PlanEntryPriority`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanEntryPriority {
    /// Critical to the overall goal.
    High,
    /// Important but not critical.
    Medium,
    /// Nice to have but not essential.
    Low,
}

/// Where a [`PlanEntry`] got to, mirroring ACP's `PlanEntryStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanEntryStatus {
    /// Not started yet.
    Pending,
    /// Currently being worked on.
    InProgress,
    /// Successfully completed.
    Completed,
}
