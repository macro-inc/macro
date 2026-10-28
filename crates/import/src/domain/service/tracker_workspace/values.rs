//! Mapping tracker task fields and preserving all source content.
use super::*;

pub(in crate::domain::service) fn target_id(ledger: Uuid) -> Uuid {
    Uuid::new_v5(&ledger, b"tracker-target")
}

pub(in crate::domain::service) fn properties(issue: &Issue) -> ImportedTaskProperties {
    let status = match issue.status_category.to_ascii_lowercase().as_str() {
        "backlog" | "unstarted" | "new" | "indeterminate_new" => Some("Not Started"),
        "started" | "indeterminate" => Some("In Progress"),
        "completed" | "done" => Some("Completed"),
        "canceled" | "cancelled" => Some("Canceled"),
        _ => super::super::map_linear_status(&issue.status),
    };
    let priority = issue.priority.as_deref().and_then(|priority| {
        match priority.to_ascii_lowercase().as_str() {
            "highest" | "blocker" | "critical" => Some("Urgent"),
            "lowest" | "minor" | "trivial" => Some("Low"),
            _ => super::super::map_linear_priority(priority),
        }
    });
    ImportedTaskProperties {
        status: status.map(str::to_string),
        priority: priority.map(str::to_string),
        due_date: issue.due_date.clone(),
        assignee_email: issue.assignee_email.clone(),
    }
}

pub(in crate::domain::service) fn group_body(group: &Group) -> String {
    [
        group.description.clone().unwrap_or_default(),
        group
            .url
            .as_ref()
            .map(|url| format!("[View source]({url})"))
            .unwrap_or_default(),
    ]
    .join("\n\n")
}

pub(in crate::domain::service) fn task_body(issue: &Issue) -> String {
    let mut body = issue.description.clone();
    let mut details = vec![
        format!("Source: [{}]({})", issue.identifier, issue.url),
        format!("Status: {}", issue.status),
    ];
    if let Some(kind) = &issue.issue_type {
        details.push(format!("Type: {kind}"));
    }
    if let Some(priority) = &issue.priority {
        details.push(format!("Priority: {priority}"));
    }
    if let Some(assignee) = &issue.assignee_email {
        details.push(format!("Assignee: {assignee}"));
    }
    if let Some(due) = &issue.due_date {
        details.push(format!("Due: {due}"));
    }
    if let Some(estimate) = issue.estimate {
        details.push(format!("Estimate: {estimate}"));
    }
    if let Some(cycle) = &issue.cycle {
        details.push(format!("Cycle: {}", cycle.as_str()));
    }
    if !issue.labels.is_empty() {
        details.push(format!("Labels: {}", issue.labels.join(", ")));
    }
    body.push_str(&format!("\n\n---\n{}", details.join(" · ")));
    if !issue.comments.is_empty() {
        body.push_str("\n\n## Comments\n");
        for comment in &issue.comments {
            body.push_str(&format!(
                "\n### {}{}\n\n{}\n",
                comment.author,
                comment
                    .created_at
                    .as_ref()
                    .map(|at| format!(" · {at}"))
                    .unwrap_or_default(),
                comment.body
            ));
        }
    }
    body
}
