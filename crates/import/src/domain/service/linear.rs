//! Linear discovery and mapping: the connected user's open assigned issues
//! become Macro tasks, deterministically, from Linear's own API.

use super::rate_limit::retry_rate_limited;
use super::{GatherMode, ImportServiceImpl};
use crate::domain::models::{ImportSource, LinearIssue, LinearIssueMeta, LinearStateType};
use crate::domain::ports::{
    ApiSourceError, CanonicalImportRepo, EntityCreator, ImportApis, ImportRepo,
    ImportedTaskProperties, LinearSource, SlackWorkspaceSource,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;

#[cfg(test)]
mod test;

/// How many issues one run imports at most.
pub(crate) const MAX_LINEAR_ISSUES: usize = 50;

/// Default for hosts that have not attached a Linear reader.
pub struct NoLinearSource;

impl LinearSource for NoLinearSource {
    async fn assigned_open_issues(
        &self,
        _: &MacroUserIdStr<'static>,
        _: usize,
    ) -> Result<Vec<LinearIssue>, ApiSourceError> {
        Err(ApiSourceError::NotConnected(ImportSource::Linear))
    }
}

/// The issues one run imports: open, unarchived, most recently updated
/// first, at most `cap`.
pub(crate) fn select_linear_issues(mut issues: Vec<LinearIssue>, cap: usize) -> Vec<LinearIssue> {
    issues.retain(|issue| issue.state.kind.is_open() && !issue.archived);
    // Ties keep a stable, deterministic order.
    issues.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.identifier.cmp(&b.identifier))
    });
    issues.dedup_by(|a, b| a.id == b.id);
    issues.truncate(cap);
    issues
}

/// Ledger metadata for one discovered issue: everything the import needs,
/// so the import itself never reads Linear again.
pub(crate) fn linear_issue_meta(issue: &LinearIssue) -> LinearIssueMeta {
    LinearIssueMeta {
        identifier: Some(issue.identifier.clone()),
        title: issue.title.clone(),
        description: issue.description.clone(),
        status: Some(issue.state.name.clone()),
        priority: linear_priority_label(issue.priority).map(str::to_string),
        assignee: None,
        assignee_email: None,
        due_date: issue
            .due_date
            .map(|date| date.format("%Y-%m-%d").to_string()),
        url: Some(issue.url.clone()),
        linear_id: Some(issue.id.clone()),
        state_type: Some(issue.state.kind),
        updated_at: Some(issue.updated_at.to_rfc3339()),
    }
}

/// Macro task status for an issue: by Linear's state *type*, falling back
/// to the state name for rows staged without one (chat-staged metadata).
pub fn linear_task_status(meta: &LinearIssueMeta) -> Option<&'static str> {
    let by_name = || meta.status.as_deref().and_then(map_linear_status);
    match meta.state_type {
        Some(LinearStateType::Triage | LinearStateType::Backlog | LinearStateType::Unstarted) => {
            Some("Not Started")
        }
        Some(LinearStateType::Started) => Some(
            if meta
                .status
                .as_deref()
                .is_some_and(|name| name.to_lowercase().contains("review"))
            {
                "In Review"
            } else {
                "In Progress"
            },
        ),
        Some(LinearStateType::Completed) => Some("Completed"),
        Some(LinearStateType::Canceled) => Some("Canceled"),
        Some(LinearStateType::Other) | None => by_name(),
    }
}

/// Map a Linear workflow status *name* onto Macro's task status label, for
/// rows that carry no state type. `None` for anything unrecognized.
pub fn map_linear_status(status: &str) -> Option<&'static str> {
    match status.trim().to_ascii_lowercase().as_str() {
        "backlog" | "todo" | "to do" | "triage" | "unstarted" | "not started" | "planned" => {
            Some("Not Started")
        }
        "in progress" | "started" | "doing" => Some("In Progress"),
        "in review" | "review" | "code review" => Some("In Review"),
        "done" | "completed" | "closed" | "merged" => Some("Completed"),
        "canceled" | "cancelled" | "duplicate" | "won't do" | "wont do" => Some("Canceled"),
        _ => None,
    }
}

/// Map a Linear priority label onto Macro's task priority label. `None` for
/// unrecognized labels and for Linear's explicit "No priority".
pub fn map_linear_priority(priority: &str) -> Option<&'static str> {
    match priority.trim().to_ascii_lowercase().as_str() {
        "urgent" => Some("Urgent"),
        "high" => Some("High"),
        "medium" | "normal" => Some("Medium"),
        "low" => Some("Low"),
        _ => None,
    }
}

/// Macro's priority label for Linear's numeric priority; `None` for none.
fn linear_priority_label(value: u8) -> Option<&'static str> {
    match value {
        1 => Some("Urgent"),
        2 => Some("High"),
        3 => Some("Medium"),
        4 => Some("Low"),
        _ => None,
    }
}

/// The system properties an imported Linear issue carries. Discovered
/// issues are the user's own assignments, so the assignee is the importing
/// user; chat-staged rows keep whatever assignee email they named.
pub fn linear_task_properties(
    meta: &LinearIssueMeta,
    user: &MacroUserIdStr<'static>,
) -> ImportedTaskProperties {
    let discovered = meta.linear_id.is_some();
    ImportedTaskProperties {
        status: linear_task_status(meta).map(String::from),
        priority: meta
            .priority
            .as_deref()
            .and_then(map_linear_priority)
            .map(String::from),
        due_date: meta.due_date.clone(),
        assignee_email: if discovered {
            Some(user.email_str().to_string())
        } else {
            meta.assignee_email.clone()
        },
    }
}

/// Compose the task name and body for one issue: the plain title, then the
/// description verbatim and a provenance footer. Status/priority labels
/// that could not be mapped onto task properties stay visible in the footer.
pub fn linear_task_content(meta: &LinearIssueMeta) -> (String, String) {
    let name = meta.title.trim().to_string();
    let source_link = match (meta.identifier.as_deref(), meta.url.as_deref()) {
        (Some(identifier), Some(url)) => format!("[{identifier}]({url})"),
        (None, Some(url)) => format!("[Linear issue]({url})"),
        (Some(identifier), None) => identifier.to_string(),
        (None, None) => String::new(),
    };
    let unmapped_status = meta
        .status
        .as_deref()
        .filter(|_| linear_task_status(meta).is_none());
    let unmapped_priority = meta
        .priority
        .as_deref()
        .filter(|priority| map_linear_priority(priority).is_none());
    let footer = [
        unmapped_status.map(|status| format!("Status: {status}")),
        unmapped_priority.map(|priority| format!("Priority: {priority}")),
        Some(if source_link.is_empty() {
            "Imported from Linear".to_string()
        } else {
            format!("Imported from Linear · {source_link}")
        }),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let markdown = match meta
        .description
        .as_deref()
        .map(str::trim_end)
        .filter(|description| !description.trim().is_empty())
    {
        Some(description) => format!("{description}\n\n{footer}"),
        None => footer,
    };
    (name, markdown)
}

/// Discover the user's open assigned issues and stage them, freshest first.
/// A user whose Linear connection is not a Pipedream one is skipped: the
/// API path needs the Pipedream connection.
pub(super) async fn gather_linear<R, S, C, W, A>(
    service: &ImportServiceImpl<R, S, C, W, A>,
    user: &MacroUserIdStr<'static>,
    mode: GatherMode,
) -> anyhow::Result<usize>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
    A: ImportApis,
{
    let linear = service.apis.linear();
    let issues = match retry_rate_limited(|| linear.assigned_open_issues(user, MAX_LINEAR_ISSUES))
        .await
    {
        Ok(issues) => issues,
        Err(ApiSourceError::NotConnected(_)) => {
            tracing::warn!("Linear is not connected through Pipedream; skipping Linear discovery");
            return Ok(0);
        }
        Err(error) => return Err(error.into()),
    };
    let items = select_linear_issues(issues, MAX_LINEAR_ISSUES)
        .iter()
        .map(|issue| {
            Ok((
                issue.identifier.clone(),
                serde_json::to_value(linear_issue_meta(issue))?,
            ))
        })
        .collect::<anyhow::Result<_>>()?;
    Ok(service
        .stage_discovered(user, mode, ImportSource::Linear, items)
        .await)
}
