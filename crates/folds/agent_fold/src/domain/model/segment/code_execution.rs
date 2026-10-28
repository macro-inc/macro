//! SDK activity carried by the internal code tool's receipt, independent of harness.

use serde::Deserialize;

use super::{ActivityRow, ActivityStatus, ToolDetail, ToolName};

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

pub(super) fn rows(
    id: &str,
    name: &ToolName,
    detail: &ToolDetail,
    closed: bool,
) -> Option<Vec<ActivityRow>> {
    if !matches!(name, ToolName::Mcp { server, tool } if server == "macro_internal" && tool == "ExecuteCode")
    {
        return None;
    }
    let output = match detail {
        ToolDetail::Macro { output, .. } => output.as_ref(),
        ToolDetail::Other { result, .. } => result.as_ref(),
        _ => None,
    }?;
    let activity: Vec<Operation> = serde_json::from_value(output.get("activity")?.clone()).ok()?;
    if activity.is_empty() {
        return None;
    }
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
            })
            .collect(),
    )
}
