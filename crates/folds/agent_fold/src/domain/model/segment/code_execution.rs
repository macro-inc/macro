//! How code-mode calls read in a conversation, independent of harness.
//!
//! People never see that the agent writes code: a code execution reads as the
//! SDK activity its receipt carries, and the agent's lookups of its own tools
//! are not steps at all.

use serde::Deserialize;

use super::{ActivityRow, ActivityStatus, ToolDetail, ToolName, ToolStatus};

/// The row of a code execution with no workspace steps to show, while it runs.
const WORKING: &str = "Working on it";
/// The same row once the execution succeeded.
const FINISHED: &str = "Finished a step";
/// The same row once the execution failed.
const FAILED: &str = "A step failed";
/// The same row once the execution was cancelled, or its turn ended first.
const INTERRUPTED: &str = "Step interrupted";

/// The detail of a background job's row.
const IN_THE_BACKGROUND: &str = "Running in the background";

/// Labels of a code-execution row that names no workspace step. They say
/// nothing about the work, and the live status line is told so.
pub const UNNAMED_STEP_LABELS: [&str; 4] = [WORKING, FINISHED, FAILED, INTERRUPTED];

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
    // A lookup has no segment of its own, but one between two steps still
    // falls inside their segment's slice.
    if is_tool_lookup(name) {
        return Some(Vec::new());
    }
    // Macro's own agent runs code on the internal server; other agents reach
    // the same tool through Macro's public MCP server.
    if !matches!(name, ToolName::Mcp { server, tool } if matches!(server.as_str(), "macro" | "macro_internal") && tool == "ExecuteCode")
    {
        return None;
    }
    let receipt = receipt(detail);
    // A background job's launch: its card shows its progress; the
    // conversation reads it as the work it started. A launch that failed its
    // check or was stopped never ran, and reads like any other program.
    if let Some(title) = receipt
        .filter(|receipt| program_status(Some(receipt)) == Some("running"))
        .and_then(job_title)
    {
        return Some(vec![ActivityRow {
            id: id.to_owned(),
            label: title.to_owned(),
            detail: Some(IN_THE_BACKGROUND.to_owned()),
            status: ActivityStatus::Completed,
            card: None,
        }]);
    }
    let activity = receipt
        .and_then(operations)
        .filter(|activity| !activity.is_empty());
    let Some(activity) = activity else {
        return Some(vec![workspace_row(id, status, receipt, closed)]);
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

/// The execution receipt a finished call returned.
fn receipt(detail: &ToolDetail) -> Option<&serde_json::Value> {
    match detail {
        ToolDetail::Macro { output, .. } => output.as_ref(),
        ToolDetail::Other { result, .. } => result.as_ref(),
        _ => None,
    }
}

/// The title of the background job a receipt started, if it started one.
fn job_title(receipt: &serde_json::Value) -> Option<&str> {
    receipt.get("job")?.get("title")?.as_str()
}

fn operations(receipt: &serde_json::Value) -> Option<Vec<Operation>> {
    serde_json::from_value(receipt.get("activity")?.clone()).ok()
}

/// A program that threw, ran out of time or was cancelled still returns its
/// receipt, so the call completes; only the receipt says how the program ended.
fn program_status(receipt: Option<&serde_json::Value>) -> Option<&str> {
    receipt?.get("status")?.as_str()
}

/// A code execution with no workspace steps to show yet, or none at all.
/// Nothing names what it does, so the row only says how far it got.
fn workspace_row(
    id: &str,
    status: ToolStatus,
    receipt: Option<&serde_json::Value>,
    closed: bool,
) -> ActivityRow {
    let (label, status) = match status {
        ToolStatus::Pending | ToolStatus::Running if closed => {
            (INTERRUPTED, ActivityStatus::Interrupted)
        }
        ToolStatus::Pending | ToolStatus::Running => (WORKING, ActivityStatus::Running),
        ToolStatus::Completed => match program_status(receipt) {
            Some("failed" | "timed_out") => (FAILED, ActivityStatus::Failed),
            Some("cancelled") => (INTERRUPTED, ActivityStatus::Interrupted),
            _ => (FINISHED, ActivityStatus::Completed),
        },
        ToolStatus::Failed => (FAILED, ActivityStatus::Failed),
    };
    ActivityRow {
        id: id.to_owned(),
        label: label.to_owned(),
        detail: None,
        status,
        card: None,
    }
}
