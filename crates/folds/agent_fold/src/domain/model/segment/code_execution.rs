//! How code-mode calls read in a conversation, independent of harness.
//!
//! People never see that the agent writes code: a code execution reads as the
//! SDK activity its receipt carries, and the agent's lookups of its own tools
//! are not steps at all.

use serde::Deserialize;

use super::{ActivityRow, ActivityStatus, ToolDetail, ToolName, ToolStatus};

/// The agent looking up its own tools: code-mode discovery and deferred-tool
/// search. Like a thought, it belongs to no segment and makes no row.
const LOOKUP_TOOLS: [&str; 4] = [
    "DescribeCodeTools",
    "ReadCodeDocs",
    "SearchTools",
    "LoadTools",
];

pub(super) fn is_tool_lookup(name: &ToolName) -> bool {
    match name {
        ToolName::Native { name } => LOOKUP_TOOLS.contains(&name.as_str()),
        ToolName::Mcp { server, tool } => {
            matches!(server.as_str(), "macro" | "macro_internal")
                && LOOKUP_TOOLS.contains(&tool.as_str())
        }
    }
}

// Read only the presentation fields of agent_code_mode's ExecutionReceipt.
// The wasm fold cannot depend on the execution service and its native runtime.
#[derive(Deserialize)]
struct Operation {
    id: u64,
    label: String,
    status: Status,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    Completed,
    Failed,
    Unknown,
}

/// The rows a code-mode call reads as, or `None` for any other call.
pub(super) fn rows(
    id: &str,
    name: &ToolName,
    status: ToolStatus,
    detail: &ToolDetail,
    closed: bool,
) -> Option<Vec<ActivityRow>> {
    if is_tool_lookup(name) {
        return Some(Vec::new());
    }
    if !matches!(name, ToolName::Mcp { server, tool } if server == "macro_internal" && tool == "ExecuteCode")
    {
        return None;
    }
    let activity = operations(detail).filter(|activity| !activity.is_empty());
    let Some(activity) = activity else {
        return Some(vec![workspace_row(id, status, closed)]);
    };
    Some(
        activity
            .into_iter()
            .take(128)
            .map(|operation| ActivityRow {
                id: format!("{id}:{}", operation.id),
                label: operation.label,
                detail: None,
                status: match operation.status {
                    Status::Running if !closed => ActivityStatus::Running,
                    Status::Completed => ActivityStatus::Completed,
                    Status::Failed => ActivityStatus::Failed,
                    Status::Running | Status::Unknown => ActivityStatus::Interrupted,
                },
                card: None,
            })
            .collect(),
    )
}

fn operations(detail: &ToolDetail) -> Option<Vec<Operation>> {
    let output = match detail {
        ToolDetail::Macro { output, .. } => output.as_ref(),
        ToolDetail::Other { result, .. } => result.as_ref(),
        _ => None,
    }?;
    serde_json::from_value(output.get("activity")?.clone()).ok()
}

/// A code execution with no workspace steps to show yet, or none at all.
fn workspace_row(id: &str, status: ToolStatus, closed: bool) -> ActivityRow {
    let (label, status) = match status {
        ToolStatus::Pending | ToolStatus::Running if closed => {
            ("Worked in your workspace", ActivityStatus::Interrupted)
        }
        ToolStatus::Pending | ToolStatus::Running => {
            ("Working in your workspace", ActivityStatus::Running)
        }
        ToolStatus::Completed => ("Worked in your workspace", ActivityStatus::Completed),
        ToolStatus::Failed => ("Workspace step failed", ActivityStatus::Failed),
    };
    ActivityRow {
        id: id.to_owned(),
        label: label.to_owned(),
        detail: None,
        status,
        card: None,
    }
}
