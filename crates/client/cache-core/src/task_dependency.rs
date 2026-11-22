//! Authored task-property intent, replayed against the preceding effective graph.

use serde::{Deserialize, Serialize};

/// One task property assignment, without copied neighborhood records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskDependencyRecipe {
    /// Edited task's stable ID.
    pub task_id: String,
    /// Authored property assignment.
    pub change: TaskDependencyChange,
}

/// Only dependency and completion assignments affect the reciprocal graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TaskDependencyChange {
    /// Replace the edited task's prerequisites.
    DependsOn {
        /// Complete authored prerequisite set.
        #[serde(rename = "targetIds")]
        target_ids: Vec<String>,
    },
    /// Replace the edited task's dependents.
    Blocking {
        /// Complete authored dependent set.
        #[serde(rename = "targetIds")]
        target_ids: Vec<String>,
    },
    /// Replace the edited task's status options.
    Status {
        /// Complete authored option set.
        #[serde(rename = "optionIds")]
        option_ids: Vec<String>,
    },
}

pub(crate) const DEPENDS_ON: &str = "00000001-0000-0000-0000-000000000007";
pub(crate) const BLOCKING: &str = "00000001-0000-0000-0000-000000000015";
pub(crate) const STATUS: &str = "00000001-0000-0000-0000-000000000002";
pub(crate) const COMPLETED: &str = "00000001-0000-0000-0002-000000000004";

impl TaskDependencyRecipe {
    pub(crate) fn definition(&self) -> &str {
        match self.change {
            TaskDependencyChange::DependsOn { .. } => DEPENDS_ON,
            TaskDependencyChange::Blocking { .. } => BLOCKING,
            TaskDependencyChange::Status { .. } => STATUS,
        }
    }

    pub(crate) fn targets(&self) -> &[String] {
        match &self.change {
            TaskDependencyChange::DependsOn { target_ids }
            | TaskDependencyChange::Blocking { target_ids } => target_ids,
            TaskDependencyChange::Status { .. } => &[],
        }
    }
}
