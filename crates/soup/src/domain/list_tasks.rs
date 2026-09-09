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
use item_filters::ast::{
    EntityFilterAst,
    date::DateLiteral,
    document::DocumentLiteral,
    properties::{EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::SimpleSortMethod;
use models_properties::service::property_value::PropertyValue;
use models_properties::service::tag_sets::AppliedTag;
use models_soup::SoupProperty;
use models_soup::document::{SoupDocument, SoupDocumentSubType};
use schemars::JsonSchema;
use serde::Deserialize;
use std::cmp::Reverse;
use std::collections::HashMap;
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

/// Every priority option, used to express "no priority" as a negation.
const ALL_PRIORITIES: [PriorityOption; 4] = [
    PriorityOption::Low,
    PriorityOption::Medium,
    PriorityOption::High,
    PriorityOption::Urgent,
];

/// Sort modes that match the tasks view, plus recency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskSort {
    /// Most recently updated first.
    RecentlyUpdated,
    /// Most recently viewed first.
    RecentlyViewed,
    /// Most recently created first.
    RecentlyCreated,
    /// Urgent first, then High / Medium / Low / no priority.
    Priority,
    /// Not Started first, then In Progress / In Review / Completed / Canceled.
    Status,
    /// Soonest due date first; tasks with no due date last.
    DueDate,
}

/// Whose tasks to match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskAssigneeScope {
    /// Any owner or assignee.
    Any,
    /// The My tasks tab: owned by **or** assigned to this user.
    Mine(String),
    /// Assigned to this Macro user id (`macro|email`).
    Assignee(String),
}

/// Resolved task-list query after the inbound adapter applies defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskListQuery {
    /// Status options to match. Empty means any status.
    pub statuses: Vec<StatusOption>,
    /// Priority buckets to match; `None` is the "no priority" bucket.
    /// Empty means any priority.
    pub priorities: Vec<Option<PriorityOption>>,
    /// Whose tasks to match.
    pub assignee: TaskAssigneeScope,
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
            || self.search_needle().is_some()
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
        let properties_filter = and_all(self.properties_filter()?.into_iter().chain(tag_filter));
        Ok(EntityFilterAst {
            document_filter: Some(Arc::new(self.document_filter()?)),
            properties_filter: properties_filter.map(Arc::new),
            ..EntityFilterAst::match_nothing()
        })
    }

    fn document_filter(&self) -> Result<Expr<DocumentLiteral>, String> {
        let mut parts = vec![Expr::val(DocumentLiteral::SubType(DocumentSubType::Task))];
        if let TaskAssigneeScope::Mine(user_id) = &self.assignee {
            let owner = MacroUserIdStr::try_from(user_id.clone()).map_err(|e| e.to_string())?;
            // `Importance(true)` is soup's "assigned to the requesting user".
            parts.push(Expr::or(
                Expr::val(DocumentLiteral::Owner(owner)),
                Expr::val(DocumentLiteral::Importance(true)),
            ));
        }
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
        Ok(and_all(parts).expect("task subtype is always present"))
    }

    fn properties_filter(&self) -> Result<Option<Expr<PropertiesLiteral>>, String> {
        let status = or_all(
            self.statuses
                .iter()
                .map(|s| select_literal(SystemPropertyKey::STATUS_UUID, s.uuid())),
        );
        let priority = or_priority(&self.priorities);
        let assignee = match &self.assignee {
            TaskAssigneeScope::Assignee(user_id) => Some(assignee_literal(user_id)?),
            TaskAssigneeScope::Any | TaskAssigneeScope::Mine(_) => None,
        };
        Ok(and_all([status, priority, assignee].into_iter().flatten()))
    }

    fn search_needle(&self) -> Option<&str> {
        self.search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }

    /// True when `task` satisfies the filters that soup cannot express
    /// (due date and name search). Status / priority / assignee are already
    /// applied in the AST.
    pub fn matches_in_memory(&self, task: &TaskRecord) -> bool {
        let due_in_range = match (self.due_after, self.due_before) {
            (None, None) => true,
            (after, before) => task.due_date.is_some_and(|due| {
                after.is_none_or(|a| due >= a) && before.is_none_or(|b| due <= b)
            }),
        };
        let name_matches = self
            .search_needle()
            .is_none_or(|needle| task.name.to_lowercase().contains(&needle.to_lowercase()));
        due_in_range && name_matches
    }
}

/// Extract a task record from a soup document. Non-tasks return `None`.
pub fn extract_task(
    doc: &SoupDocument<SoupPropertiesField>,
    tag_map: &HashMap<Uuid, AppliedTag>,
) -> Option<TaskRecord> {
    if !matches!(doc.sub_type, Some(SoupDocumentSubType::Task { .. })) {
        return None;
    }

    let property = |key: Uuid| doc.extra.properties.iter().find(|p| p.definition.id == key);

    Some(TaskRecord {
        id: doc.id,
        name: doc.name.clone(),
        status: property(SystemPropertyKey::STATUS_UUID)
            .and_then(first_select_option)
            .and_then(StatusOption::from_uuid),
        priority: property(SystemPropertyKey::PRIORITY_UUID)
            .and_then(first_select_option)
            .and_then(PriorityOption::from_uuid),
        assignees: match property(SystemPropertyKey::ASSIGNEES_UUID).and_then(|p| p.value.as_ref())
        {
            Some(PropertyValue::EntityRef(refs)) => {
                refs.iter().map(|r| r.entity_id.clone()).collect()
            }
            _ => Vec::new(),
        },
        due_date: match property(SystemPropertyKey::DUE_DATE_UUID).and_then(|p| p.value.as_ref()) {
            Some(PropertyValue::Date(date)) => Some(*date),
            _ => None,
        },
        project_id: doc.project_id,
        tags: doc.extra.applied_tags(tag_map),
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        viewed_at: doc.viewed_at,
    })
}

/// Sort `tasks` in place according to `sort`. Ties fall back to `updated_at`
/// descending, matching the tasks-view client sort.
pub fn sort_tasks(tasks: &mut [TaskRecord], sort: TaskSort) {
    tasks.sort_by(|a, b| {
        let primary = match sort {
            TaskSort::RecentlyUpdated => std::cmp::Ordering::Equal,
            TaskSort::RecentlyViewed => {
                some_first(a.viewed_at.map(Reverse), b.viewed_at.map(Reverse))
            }
            TaskSort::RecentlyCreated => b.created_at.cmp(&a.created_at),
            TaskSort::Priority => priority_rank(a.priority).cmp(&priority_rank(b.priority)),
            TaskSort::Status => status_rank(a.status).cmp(&status_rank(b.status)),
            TaskSort::DueDate => some_first(a.due_date, b.due_date),
        };
        primary.then_with(|| b.updated_at.cmp(&a.updated_at))
    });
}

fn priority_rank(priority: Option<PriorityOption>) -> u8 {
    match priority {
        Some(PriorityOption::Urgent) => 0,
        Some(PriorityOption::High) => 1,
        Some(PriorityOption::Medium) => 2,
        Some(PriorityOption::Low) => 3,
        None => 4,
    }
}

fn status_rank(status: Option<StatusOption>) -> u8 {
    match status {
        Some(StatusOption::NotStarted) => 0,
        Some(StatusOption::InProgress) => 1,
        Some(StatusOption::InReview) => 2,
        Some(StatusOption::Completed) => 3,
        Some(StatusOption::Canceled) => 4,
        None => 5,
    }
}

/// `a.cmp(b)` where `None` always sorts after `Some`.
fn some_first<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
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

fn select_literal(definition_id: Uuid, option_id: Uuid) -> Expr<PropertiesLiteral> {
    Expr::val(PropertiesLiteral {
        property_definition_id: definition_id,
        entity_type: Some(PropertyEntityType::Task),
        value: PropertyMatchValue::SelectOption(option_id),
    })
}

/// OR of the selected priorities; `None` in the list adds "no priority",
/// expressed as the negation of every priority option.
fn or_priority(priorities: &[Option<PriorityOption>]) -> Option<Expr<PropertiesLiteral>> {
    let set = or_all(
        priorities
            .iter()
            .flatten()
            .map(|p| select_literal(SystemPropertyKey::PRIORITY_UUID, p.uuid())),
    );
    let unset = priorities.contains(&None).then(|| {
        let any_priority = or_all(
            ALL_PRIORITIES
                .into_iter()
                .map(|p| select_literal(SystemPropertyKey::PRIORITY_UUID, p.uuid())),
        )
        .expect("priority options are non-empty");
        Expr::is_not(any_priority)
    });
    or_all([set, unset].into_iter().flatten())
}

fn assignee_literal(user_id: &str) -> Result<Expr<PropertiesLiteral>, String> {
    let entity_ref = EntityRefId::new(user_id.to_string()).map_err(|e| e.to_string())?;
    Ok(Expr::val(PropertiesLiteral {
        property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
        entity_type: Some(PropertyEntityType::Task),
        value: PropertyMatchValue::EntityRef(entity_ref),
    }))
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
