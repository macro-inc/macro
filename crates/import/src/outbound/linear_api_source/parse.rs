//! Linear GraphQL wire shapes → domain models.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;

use crate::domain::models::{LinearIssue, LinearState, LinearStateType};
use crate::domain::ports::ApiSourceError;

/// One page of the viewer's assigned issues.
pub(super) struct AssignedIssuesPage {
    pub(super) issues: Vec<LinearIssue>,
    pub(super) next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct Envelope {
    data: Data,
}

#[derive(Deserialize)]
struct Data {
    viewer: Viewer,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Viewer {
    assigned_issues: Connection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    nodes: Vec<serde_json::Value>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Issue {
    id: String,
    identifier: String,
    title: String,
    description: Option<String>,
    url: String,
    priority: Option<f64>,
    due_date: Option<NaiveDate>,
    updated_at: DateTime<Utc>,
    archived_at: Option<DateTime<Utc>>,
    state: State,
}

#[derive(Deserialize)]
struct State {
    name: String,
    #[serde(rename = "type")]
    kind: LinearStateType,
}

/// Parse one GraphQL response. A malformed issue is skipped with a warning
/// so one odd record never hides the rest.
pub(super) fn parse_assigned_issues_page(
    body: &serde_json::Value,
) -> Result<AssignedIssuesPage, ApiSourceError> {
    let envelope: Envelope = serde_json::from_value(body.clone())
        .map_err(|e| anyhow::anyhow!("unexpected Linear response shape: {e}"))?;
    let viewer = envelope.data.viewer;
    let issues = viewer
        .assigned_issues
        .nodes
        .into_iter()
        .filter_map(|node| match serde_json::from_value::<Issue>(node) {
            Ok(issue) => Some(issue.into()),
            Err(error) => {
                tracing::warn!(%error, "skipping unreadable Linear issue");
                None
            }
        })
        .collect();
    let page_info = viewer.assigned_issues.page_info;
    Ok(AssignedIssuesPage {
        issues,
        next_cursor: page_info
            .has_next_page
            .then_some(page_info.end_cursor)
            .flatten(),
    })
}

impl From<Issue> for LinearIssue {
    fn from(issue: Issue) -> Self {
        Self {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue
                .description
                .filter(|description| !description.trim().is_empty()),
            url: issue.url,
            priority: issue
                .priority
                .filter(|value| (0.0..=4.0).contains(value))
                .map_or(0, |value| value as u8),
            due_date: issue.due_date,
            updated_at: issue.updated_at,
            archived: issue.archived_at.is_some(),
            state: LinearState {
                name: issue.state.name,
                kind: issue.state.kind,
            },
        }
    }
}

/// Whether a GraphQL error payload reports rate limiting.
pub(super) fn is_rate_limited(body: &serde_json::Value) -> bool {
    errors(body).any(|error| {
        error
            .pointer("/extensions/code")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|code| code.eq_ignore_ascii_case("RATELIMITED"))
    })
}

/// The GraphQL error messages, joined, for logs and `last_error`.
pub(super) fn error_messages(body: &serde_json::Value) -> String {
    let messages: Vec<&str> = errors(body)
        .filter_map(|error| error.get("message").and_then(serde_json::Value::as_str))
        .collect();
    if messages.is_empty() {
        "no error details".to_string()
    } else {
        messages.join("; ")
    }
}

fn errors(body: &serde_json::Value) -> impl Iterator<Item = &serde_json::Value> {
    body.get("errors")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
}
