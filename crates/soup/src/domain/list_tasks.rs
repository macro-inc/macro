//! Task-list query policy: filters, extraction, and sort order.
//!
//! `ListTasks` is the AI-tool surface; this module owns the soup AST, the
//! in-memory due-date / name filters, and the priority/status/due-date sorts
//! that soup pagination cannot express.

#[cfg(test)]
mod test;

use crate::domain::models::SoupPropertiesField;
use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::ast::{EmailFilterAst, properties::EntityRefId};
use item_filters::ast::{
    EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use models_pagination::SimpleSortMethod;
use models_properties::DataType;
use models_properties::service::property_value::PropertyValue;
use models_properties::service::tag_sets::AppliedTag;
use models_soup::SoupProperty;
use models_soup::document::{SoupDocument, SoupDocumentSubType};
use std::sync::Arc;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

/// How many tasks to pull from soup before in-memory filter/sort.
pub const FETCH_LIMIT: u16 = 500;

/// Default page size returned to the caller.
pub const DEFAULT_LIMIT: u16 = 50;

/// Hard cap on a single `ListTasks` response.
pub const MAX_LIMIT: u16 = 200;

/// Open statuses used by the tasks view's "My tasks" tab.
pub const OPEN_STATUSES: [StatusOption; 3] = [
    StatusOption::NotStarted,
    StatusOption::InProgress,
    StatusOption::InReview,
];

/// Priority filter, including the explicit "no priority" bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPriorityFilter {
    /// A set priority option.
    Option(PriorityOption),
    /// Task has no Priority value.
    Unset,
}

/// Sort modes that match the tasks view, plus recency.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskSort {
    /// Most recently updated first.
    RecentlyUpdated,
    /// Most recently viewed first.
    RecentlyViewed,
    /// Most recently created first.
    RecentlyCreated,
    /// Urgent first, then High / Medium / Low / unset.
    Priority,
    /// Not Started first, then In Progress / In Review / Completed / Canceled.
    Status,
    /// Soonest due date first; tasks with no due date last.
    DueDate,
}

/// Resolved task-list query after the inbound adapter applies defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskListQuery {
    /// Status options to match. Empty means any status.
    pub statuses: Vec<StatusOption>,
    /// Priority buckets to match. Empty means any priority.
    pub priorities: Vec<TaskPriorityFilter>,
    /// Assignee Macro user id (`macro|email`). `None` means any assignee.
    pub assignee_user_id: Option<String>,
    /// Restrict to tasks in this project.
    pub project_id: Option<Uuid>,
    /// Inclusive due-date lower bound.
    pub due_after: Option<DateTime<Utc>>,
    /// Inclusive due-date upper bound.
    pub due_before: Option<DateTime<Utc>>,
    /// Inclusive `updated_at` lower bound.
    pub updated_after: Option<DateTime<Utc>>,
    /// Exclusive `updated_at` upper bound.
    pub updated_before: Option<DateTime<Utc>>,
    /// Case-insensitive name substring. Applied in memory.
    pub search: Option<String>,
    /// Sort order.
    pub sort: TaskSort,
}

/// A task row extracted from a soup document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRecord {
    /// Task document id.
    pub id: Uuid,
    /// Task title.
    pub name: String,
    /// Status option, when set.
    pub status: Option<StatusOption>,
    /// Priority option, when set.
    pub priority: Option<PriorityOption>,
    /// Assignee Macro user ids.
    pub assignees: Vec<String>,
    /// Due date, when set.
    pub due_date: Option<DateTime<Utc>>,
    /// Project the task belongs to, when set.
    pub project_id: Option<Uuid>,
    /// Tags visible to the caller.
    pub tags: Vec<AppliedTag>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Last viewed timestamp.
    pub viewed_at: Option<DateTime<Utc>>,
}

impl TaskListQuery {
    /// Soup sort to use for the fetch. Property sorts fetch by `updated_at`
    /// and reorder in memory.
    pub fn soup_sort_method(&self) -> SimpleSortMethod {
        match self.sort {
            TaskSort::RecentlyViewed => SimpleSortMethod::ViewedAt,
            TaskSort::RecentlyCreated => SimpleSortMethod::CreatedAt,
            TaskSort::RecentlyUpdated
            | TaskSort::Priority
            | TaskSort::Status
            | TaskSort::DueDate => SimpleSortMethod::UpdatedAt,
        }
    }

    /// Whether the fetch must over-read so in-memory filter/sort can run.
    pub fn needs_overfetch(&self) -> bool {
        matches!(
            self.sort,
            TaskSort::Priority | TaskSort::Status | TaskSort::DueDate
        ) || self.due_after.is_some()
            || self.due_before.is_some()
            || self.search.as_deref().is_some_and(|s| !s.trim().is_empty())
    }

    /// Soup page size for this query.
    pub fn soup_limit(&self, response_limit: u16) -> u16 {
        if self.needs_overfetch() {
            FETCH_LIMIT
        } else {
            response_limit
        }
    }

    /// Task-only soup AST, with status / priority / assignee / project /
    /// updated-at pushed to the query and every other entity type excluded.
    pub fn entity_filter_ast(
        &self,
        tag_filter: Option<Expr<PropertiesLiteral>>,
    ) -> Result<EntityFilterAst, String> {
        let document_filter = self.document_filter();
        let properties_filter = match (self.properties_filter()?, tag_filter) {
            (Some(existing), Some(tags)) => Some(Expr::and(existing, tags)),
            (None, Some(tags)) => Some(tags),
            (existing, None) => existing,
        };

        Ok(task_only_ast(document_filter, properties_filter))
    }

    fn document_filter(&self) -> Expr<DocumentLiteral> {
        let mut parts = vec![Expr::val(DocumentLiteral::SubType(DocumentSubType::Task))];
        if let Some(project_id) = self.project_id {
            parts.push(Expr::val(DocumentLiteral::ProjectId(project_id)));
        }
        if let Some(updated_after) = self.updated_after {
            parts.push(Expr::val(DocumentLiteral::UpdatedAt(
                DateLiteral::GreaterThanOrEqual(updated_after),
            )));
        }
        if let Some(updated_before) = self.updated_before {
            parts.push(Expr::val(DocumentLiteral::UpdatedAt(
                DateLiteral::LessThan(updated_before),
            )));
        }
        and_all(parts).expect("task subtype is always present")
    }

    fn properties_filter(&self) -> Result<Option<Expr<PropertiesLiteral>>, String> {
        let mut parts = Vec::new();
        if let Some(status) = or_status(&self.statuses) {
            parts.push(status);
        }
        if let Some(priority) = or_priority(&self.priorities) {
            parts.push(priority);
        }
        if let Some(assignee) = self.assignee_user_id.as_deref() {
            parts.push(assignee_literal(assignee)?);
        }
        Ok(and_all(parts))
    }

    /// True when `task` satisfies the filters that soup cannot express
    /// (due date and name search). Status / priority / assignee are already
    /// applied in the AST when possible.
    pub fn matches_in_memory(&self, task: &TaskRecord) -> bool {
        if let Some(due_after) = self.due_after {
            match task.due_date {
                Some(due) if due >= due_after => {}
                _ => return false,
            }
        }
        if let Some(due_before) = self.due_before {
            match task.due_date {
                Some(due) if due <= due_before => {}
                _ => return false,
            }
        }
        if let Some(needle) = self
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if !task.name.to_lowercase().contains(&needle.to_lowercase()) {
                return false;
            }
        }
        true
    }
}

/// Extract a task record from a soup document. Non-tasks return `None`.
pub fn extract_task(
    doc: &SoupDocument<SoupPropertiesField>,
    tag_map: &std::collections::HashMap<Uuid, AppliedTag>,
) -> Option<TaskRecord> {
    match &doc.sub_type {
        Some(SoupDocumentSubType::Task { .. }) => {}
        Some(SoupDocumentSubType::Snippet {} | SoupDocumentSubType::Skill {}) | None => {
            return None;
        }
    }

    let mut status = None;
    let mut priority = None;
    let mut assignees = Vec::new();
    let mut due_date = None;
    let mut tags = Vec::new();

    for property in &doc.extra.properties {
        let definition_id = property.definition.id;
        if definition_id == SystemPropertyKey::STATUS_UUID {
            status = first_select_option(property).and_then(StatusOption::from_uuid);
        } else if definition_id == SystemPropertyKey::PRIORITY_UUID {
            priority = first_select_option(property).and_then(PriorityOption::from_uuid);
        } else if definition_id == SystemPropertyKey::ASSIGNEES_UUID {
            if let Some(PropertyValue::EntityRef(refs)) = &property.value {
                assignees = refs.iter().map(|r| r.entity_id.clone()).collect();
            }
        } else if definition_id == SystemPropertyKey::DUE_DATE_UUID {
            if let Some(PropertyValue::Date(date)) = property.value {
                due_date = Some(date);
            }
        } else if property.definition.data_type == DataType::Tag
            && let Some(PropertyValue::SelectOption(option_ids)) = &property.value
        {
            for option_id in option_ids {
                if let Some(tag) = tag_map.get(option_id)
                    && !tags.contains(tag)
                {
                    tags.push(tag.clone());
                }
            }
        }
    }

    Some(TaskRecord {
        id: doc.id,
        name: doc.name.clone(),
        status,
        priority,
        assignees,
        due_date,
        project_id: doc.project_id,
        tags,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        viewed_at: doc.viewed_at,
    })
}

/// Sort `tasks` in place according to `sort`. Ties fall back to `updated_at`
/// descending, matching the tasks-view client sort.
pub fn sort_tasks(tasks: &mut [TaskRecord], sort: TaskSort) {
    tasks.sort_by(|a, b| match sort {
        TaskSort::RecentlyUpdated => b.updated_at.cmp(&a.updated_at),
        TaskSort::RecentlyViewed => cmp_optional_desc(a.viewed_at, b.viewed_at)
            .then_with(|| b.updated_at.cmp(&a.updated_at)),
        TaskSort::RecentlyCreated => b.created_at.cmp(&a.created_at),
        TaskSort::Priority => priority_order(a.priority)
            .cmp(&priority_order(b.priority))
            .then_with(|| b.updated_at.cmp(&a.updated_at)),
        TaskSort::Status => status_order(a.status)
            .cmp(&status_order(b.status))
            .then_with(|| b.updated_at.cmp(&a.updated_at)),
        TaskSort::DueDate => {
            cmp_optional_asc(a.due_date, b.due_date).then_with(|| b.updated_at.cmp(&a.updated_at))
        }
    });
}

fn priority_order(priority: Option<PriorityOption>) -> u8 {
    match priority {
        Some(PriorityOption::Urgent) => 0,
        Some(PriorityOption::High) => 1,
        Some(PriorityOption::Medium) => 2,
        Some(PriorityOption::Low) => 3,
        None => 4,
    }
}

fn status_order(status: Option<StatusOption>) -> u8 {
    match status {
        Some(StatusOption::NotStarted) => 0,
        Some(StatusOption::InProgress) => 1,
        Some(StatusOption::InReview) => 2,
        Some(StatusOption::Completed) => 3,
        Some(StatusOption::Canceled) => 4,
        None => 5,
    }
}

fn cmp_optional_desc<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => b.cmp(&a),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn cmp_optional_asc<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn first_select_option(property: &SoupProperty) -> Option<Uuid> {
    match &property.value {
        Some(PropertyValue::SelectOption(ids)) => ids.first().copied(),
        _ => None,
    }
}

fn or_status(statuses: &[StatusOption]) -> Option<Expr<PropertiesLiteral>> {
    or_all(statuses.iter().copied().map(|status| {
        Expr::val(PropertiesLiteral {
            property_definition_id: SystemPropertyKey::STATUS_UUID,
            entity_type: Some(PropertyEntityType::Task),
            value: PropertyMatchValue::SelectOption(status.uuid()),
        })
    }))
}

fn or_priority(priorities: &[TaskPriorityFilter]) -> Option<Expr<PropertiesLiteral>> {
    if priorities.is_empty() {
        return None;
    }

    let set: Vec<PriorityOption> = priorities
        .iter()
        .filter_map(|p| match p {
            TaskPriorityFilter::Option(option) => Some(*option),
            TaskPriorityFilter::Unset => None,
        })
        .collect();
    let include_unset = priorities
        .iter()
        .any(|p| matches!(p, TaskPriorityFilter::Unset));

    let set_expr = or_all(set.into_iter().map(|option| {
        Expr::val(PropertiesLiteral {
            property_definition_id: SystemPropertyKey::PRIORITY_UUID,
            entity_type: Some(PropertyEntityType::Task),
            value: PropertyMatchValue::SelectOption(option.uuid()),
        })
    }));
    let unset_expr = include_unset.then(no_priority_expr);

    match (set_expr, unset_expr) {
        (Some(set), Some(unset)) => Some(Expr::or(set, unset)),
        (Some(set), None) => Some(set),
        (None, Some(unset)) => Some(unset),
        (None, None) => None,
    }
}

fn no_priority_expr() -> Expr<PropertiesLiteral> {
    let any_priority = or_all(
        [
            PriorityOption::Low,
            PriorityOption::Medium,
            PriorityOption::High,
            PriorityOption::Urgent,
        ]
        .into_iter()
        .map(|option| {
            Expr::val(PropertiesLiteral {
                property_definition_id: SystemPropertyKey::PRIORITY_UUID,
                entity_type: Some(PropertyEntityType::Task),
                value: PropertyMatchValue::SelectOption(option.uuid()),
            })
        }),
    )
    .expect("priority options are non-empty");
    Expr::is_not(any_priority)
}

fn assignee_literal(user_id: &str) -> Result<Expr<PropertiesLiteral>, String> {
    let entity_ref = EntityRefId::new(user_id.to_string()).map_err(|e| e.to_string())?;
    Ok(Expr::val(PropertiesLiteral {
        property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
        entity_type: Some(PropertyEntityType::Task),
        value: PropertyMatchValue::EntityRef(entity_ref),
    }))
}

fn task_only_ast(
    document_filter: Expr<DocumentLiteral>,
    properties_filter: Option<Expr<PropertiesLiteral>>,
) -> EntityFilterAst {
    let nil = Uuid::nil();
    EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(nil)))),
        document_filter: Some(Arc::new(document_filter)),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(nil)))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(nil)))),
        email_filter: EmailFilterAst {
            tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(nil)))),
            crm_scope: None,
        },
        channel_filter: Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(nil)))),
        channel_thread_filter: Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(nil)))),
        call_filter: Some(Arc::new(Expr::val(CallLiteral::CallId(nil)))),
        crm_company_filter: Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(nil)))),
        foreign_entity_filter: Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(nil)))),
        reminder_filter: None,
        properties_filter: properties_filter.map(Arc::new),
    }
}

fn and_all<T>(exprs: impl IntoIterator<Item = Expr<T>>) -> Option<Expr<T>> {
    exprs.into_iter().reduce(Expr::and)
}

fn or_all<T>(exprs: impl IntoIterator<Item = Expr<T>>) -> Option<Expr<T>> {
    exprs.into_iter().reduce(Expr::or)
}

/// Resolve `"me"` / a bare email / a Macro user id to the entity-ref id soup
/// stores on the Assignees property.
pub fn resolve_assignee_id(assignee: &str, current_user_id: &str) -> String {
    let trimmed = assignee.trim();
    if trimmed.eq_ignore_ascii_case("me") {
        return current_user_id.to_string();
    }
    if trimmed.contains('@') && !trimmed.contains('|') {
        return format!("macro|{trimmed}");
    }
    trimmed.to_string()
}
