//! SDK activity carried by the internal code tool's receipt, independent of harness.

use serde::Deserialize;

use super::{
    ActivityCard, ActivityRow, ActivityStatus, CardAction, CardItemType, ItemFacts, SHOW,
    ToolDetail, ToolName, item_card, text,
};

// Read only the presentation fields of agent_code_mode's ExecutionReceipt.
// The wasm fold cannot depend on the execution service and its native runtime.
#[derive(Deserialize)]
struct Operation {
    id: u64,
    label: String,
    status: Status,
    /// Read on its own, so an item this version cannot open still leaves
    /// its step.
    #[serde(default)]
    item: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    Completed,
    Failed,
    Unknown,
}

/// The workspace item a completed operation created or changed, as code
/// mode recorded it.
#[derive(Deserialize)]
struct Item {
    #[serde(rename = "type")]
    item_type: CardItemType,
    id: String,
    action: CardAction,
    #[serde(default)]
    title: Option<String>,
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
    let view = shown_view(output);
    if activity.is_empty() && view.is_none() {
        return None;
    }
    let mut rows: Vec<ActivityRow> = activity
        .into_iter()
        .take(128)
        .map(|operation| ActivityRow {
            id: format!("{id}:{}", operation.id),
            label: operation.label,
            detail: None,
            card: matches!(operation.status, Status::Completed)
                .then(|| card(operation.item?))
                .flatten(),
            status: match operation.status {
                Status::Running if !closed => ActivityStatus::Running,
                Status::Completed => ActivityStatus::Completed,
                Status::Failed => ActivityStatus::Failed,
                Status::Running | Status::Unknown => ActivityStatus::Interrupted,
            },
        })
        .collect();
    // Showing the view is the run's last step, as calling Show after it
    // would have been.
    rows.extend(view.map(|view| ActivityRow {
        id: format!("{id}:view"),
        label: SHOW.done.into(),
        detail: text(Some(&view), "title"),
        card: Some(ActivityCard::View { view }),
        status: ActivityStatus::Completed,
    }));
    Some(rows)
}

/// The view a run returned for the user. Code mode checked it against the
/// schema `Show` views follow, and failed a run whose view the
/// renderer would not draw, so only a run that succeeded shows one.
fn shown_view(output: &serde_json::Value) -> Option<serde_json::Value> {
    if output.get("status")?.as_str()? != "succeeded" {
        return None;
    }
    let view = output.get("result")?.get("view")?;
    view.is_object().then(|| view.clone())
}

/// The card a completed operation earns: the same card the Macro tool that
/// does the same would have.
fn card(item: serde_json::Value) -> Option<ActivityCard> {
    let item = serde_json::from_value::<Item>(item).ok()?;
    Some(item_card(
        item.item_type,
        item.id,
        item.action,
        ItemFacts {
            title: item.title,
            ..ItemFacts::default()
        },
    ))
}
