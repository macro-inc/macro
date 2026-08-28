//! ListTasks tool for querying Macro tasks.

use crate::domain::list_tasks::{
    DEFAULT_LIMIT, MAX_LIMIT, OPEN_STATUSES, TaskListQuery, TaskPriorityFilter, TaskRecord,
    TaskSort, extract_task, resolve_assignee_id, sort_tasks,
};
use crate::domain::{
    models::{EnrichedSoupItem, SoupQuery, SoupRequest, SoupSortDirection, SoupType},
    ports::SoupService,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use email::domain::{models::PreviewView, ports::EmailService};
use filter_ast::Expr;
use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};
use models_pagination::TypeEraseCursor;
use models_properties::service::tag_sets::{AppliedTag, CallerTagSets, TagFilter, TagMatch};
use models_soup::item::SoupItem;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use system_properties::{PriorityOption, StatusOption};
use uuid::Uuid;

use super::SoupToolContext;
use super::list_entities::fetch_caller_tag_sets;

/// Which task list to query, matching the tasks view tabs.
#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskScope {
    /// Tasks assigned to the current user. Defaults to open statuses
    /// (Not Started, In Progress, In Review) unless `status` is set.
    #[default]
    MyTasks,
    /// Every task the user can see. No default assignee or status filter.
    All,
}

/// Task status labels used by the tasks view.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolTaskStatus {
    /// Not Started.
    NotStarted,
    /// In Progress.
    InProgress,
    /// In Review.
    InReview,
    /// Completed.
    Completed,
    /// Canceled.
    Canceled,
}

impl From<ToolTaskStatus> for StatusOption {
    fn from(status: ToolTaskStatus) -> Self {
        match status {
            ToolTaskStatus::NotStarted => Self::NotStarted,
            ToolTaskStatus::InProgress => Self::InProgress,
            ToolTaskStatus::InReview => Self::InReview,
            ToolTaskStatus::Completed => Self::Completed,
            ToolTaskStatus::Canceled => Self::Canceled,
        }
    }
}

impl From<StatusOption> for ToolTaskStatus {
    fn from(status: StatusOption) -> Self {
        match status {
            StatusOption::NotStarted => Self::NotStarted,
            StatusOption::InProgress => Self::InProgress,
            StatusOption::InReview => Self::InReview,
            StatusOption::Completed => Self::Completed,
            StatusOption::Canceled => Self::Canceled,
        }
    }
}

/// Task priority labels used by the tasks view, plus "no priority".
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolTaskPriority {
    /// Urgent.
    Urgent,
    /// High.
    High,
    /// Medium.
    Medium,
    /// Low.
    Low,
    /// No priority set.
    None,
}

impl From<ToolTaskPriority> for TaskPriorityFilter {
    fn from(priority: ToolTaskPriority) -> Self {
        match priority {
            ToolTaskPriority::Urgent => Self::Option(PriorityOption::Urgent),
            ToolTaskPriority::High => Self::Option(PriorityOption::High),
            ToolTaskPriority::Medium => Self::Option(PriorityOption::Medium),
            ToolTaskPriority::Low => Self::Option(PriorityOption::Low),
            ToolTaskPriority::None => Self::Unset,
        }
    }
}

/// How to order the returned tasks.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolTaskSort {
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

impl From<ToolTaskSort> for TaskSort {
    fn from(sort: ToolTaskSort) -> Self {
        match sort {
            ToolTaskSort::RecentlyUpdated => Self::RecentlyUpdated,
            ToolTaskSort::RecentlyViewed => Self::RecentlyViewed,
            ToolTaskSort::RecentlyCreated => Self::RecentlyCreated,
            ToolTaskSort::Priority => Self::Priority,
            ToolTaskSort::Status => Self::Status,
            ToolTaskSort::DueDate => Self::DueDate,
        }
    }
}

/// A select option returned with both its id and display label.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskSelectValue {
    /// Option id, usable with SetEntityProperty.
    pub option_id: Uuid,
    /// Human-readable label (e.g. "In Progress", "Urgent").
    pub label: String,
}

/// One Macro task.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskListItem {
    /// Task document id. Use with ReadContent, GetEntityProperties,
    /// SetEntityProperty (entity_type=document).
    pub id: Uuid,
    /// Task title.
    pub name: String,
    /// Status, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<TaskSelectValue>,
    /// Priority, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskSelectValue>,
    /// Assignee Macro user ids.
    pub assignees: Vec<String>,
    /// Due date, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<DateTime<Utc>>,
    /// Project the task belongs to, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,
    /// Tags visible to the user.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<AppliedTag>,
    /// Created timestamp (UTC).
    pub created_at: DateTime<Utc>,
    /// Updated timestamp (UTC).
    pub updated_at: DateTime<Utc>,
}

/// Response from ListTasks.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksResponse {
    /// Matching tasks, already sorted.
    pub tasks: Vec<TaskListItem>,
    /// Human-readable summary of the results.
    pub summary: String,
}

/// List Macro tasks the way the tasks view does: filter by status, priority,
/// assignee, due date, project, or tag; sort by priority, status, due date,
/// or recency.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListTasks",
    description = "List Macro tasks with the same filters and sorts as the tasks view. Prefer this over ListEntities for any task question (\"my tasks\", \"urgent tasks\", \"tasks assigned to me\", \"overdue\", \"in review\"). Do not use Linear or other external trackers unless the user names them.\n\nDefaults match the My tasks tab: assigned to the current user, open statuses (Not Started, In Progress, In Review), sorted by priority (Urgent first). Pass scope=\"all\" to see every task the user can access. Each row includes id, name, status, priority, assignees, dueDate, projectId, and tags — use SetEntityProperty (entity_type=document) to change those fields, and GetEntityProperties for custom properties.\n\nFilters compose with AND. Multiple values on one filter are OR (status=[\"in_progress\",\"in_review\"] matches either). dueAfter/dueBefore filter the Due Date property; updatedAfter/updatedBefore filter last edit time (use those for \"completed yesterday\")."
)]
pub struct ListTasks {
    /// My tasks (default) or every visible task.
    #[schemars(
        description = "Which list to query. \"my_tasks\" (default) is assigned to the current user with open statuses unless status is set. \"all\" drops those defaults."
    )]
    #[serde(default)]
    pub scope: TaskScope,

    /// Status values to include.
    #[schemars(
        description = "Filter by status. Values: not_started, in_progress, in_review, completed, canceled. Multiple values are OR'd. On my_tasks this defaults to the three open statuses; pass completed to see finished work."
    )]
    #[serde(default)]
    pub status: Option<Vec<ToolTaskStatus>>,

    /// Priority values to include.
    #[schemars(
        description = "Filter by priority. Values: urgent, high, medium, low, none. Multiple values are OR'd. \"none\" matches tasks with no priority set."
    )]
    #[serde(default)]
    pub priority: Option<Vec<ToolTaskPriority>>,

    /// Assignee to filter on.
    #[schemars(
        description = "Filter by assignee. Use \"me\" for the current user, a Macro user id (macro|user@example.com), or a bare email. Use ListTeamMembers to find ids. Overrides the my_tasks assignee default when set."
    )]
    #[serde(default)]
    pub assignee: Option<String>,

    /// Restrict to one project.
    #[schemars(
        description = "Only tasks in this project (UUID from ListEntities or ReadProject)."
    )]
    #[serde(default)]
    pub project_id: Option<Uuid>,

    /// Inclusive due-date lower bound.
    #[schemars(
        description = "Inclusive Due Date lower bound, RFC 3339 UTC (e.g. 2026-08-20T00:00:00Z). Tasks with no due date are excluded when this or dueBefore is set."
    )]
    #[serde(default)]
    pub due_after: Option<DateTime<Utc>>,

    /// Inclusive due-date upper bound.
    #[schemars(description = "Inclusive Due Date upper bound, RFC 3339 UTC.")]
    #[serde(default)]
    pub due_before: Option<DateTime<Utc>>,

    /// Inclusive updated-at lower bound.
    #[schemars(
        description = "Inclusive last-updated lower bound, RFC 3339 UTC. Use with status=[\"completed\"] for \"tasks I completed yesterday\"."
    )]
    #[serde(default)]
    pub updated_after: Option<DateTime<Utc>>,

    /// Exclusive updated-at upper bound.
    #[schemars(description = "Exclusive last-updated upper bound, RFC 3339 UTC.")]
    #[serde(default)]
    pub updated_before: Option<DateTime<Utc>>,

    /// Case-insensitive title substring.
    #[schemars(description = "Case-insensitive substring matched against the task title.")]
    #[serde(default)]
    pub search: Option<String>,

    /// Tag filters, same shape as ListEntities.
    #[schemars(
        description = "Filter to tasks carrying these tags — any of them by default, every one of them with tagsMatch=\"all\". Call ListTags first when unsure what tags exist."
    )]
    #[serde(default)]
    pub tags: Option<Vec<TagFilter>>,

    /// How multiple tags combine.
    #[schemars(description = "How multiple tags combine: \"any\" (default) or \"all\".")]
    #[serde(default)]
    pub tags_match: TagMatch,

    /// Sort order.
    #[schemars(
        description = "Sort order: priority (default on my_tasks), status, due_date, recently_updated (default on scope=all), recently_viewed, recently_created."
    )]
    #[serde(default)]
    pub sort_by: Option<ToolTaskSort>,

    /// Maximum tasks to return.
    #[schemars(description = "Maximum tasks to return. Defaults to 50; max 200.")]
    #[serde(default)]
    pub limit: Option<u16>,
}

impl ToolAnnotated for ListTasks {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List tasks");
}

impl ListTasks {
    pub(super) fn resolved_query(&self, current_user_id: &str) -> TaskListQuery {
        let statuses = match self.status.as_deref() {
            Some(status) if !status.is_empty() => {
                status.iter().copied().map(StatusOption::from).collect()
            }
            _ => match self.scope {
                TaskScope::MyTasks => OPEN_STATUSES.to_vec(),
                TaskScope::All => vec![],
            },
        };

        let assignee_user_id = match self
            .assignee
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(assignee) => Some(resolve_assignee_id(assignee, current_user_id)),
            None => match self.scope {
                TaskScope::MyTasks => Some(current_user_id.to_string()),
                TaskScope::All => None,
            },
        };

        let sort = match self.sort_by {
            Some(sort) => TaskSort::from(sort),
            None => match self.scope {
                TaskScope::MyTasks => TaskSort::Priority,
                TaskScope::All => TaskSort::RecentlyUpdated,
            },
        };

        TaskListQuery {
            statuses,
            priorities: self
                .priority
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .copied()
                .map(TaskPriorityFilter::from)
                .collect(),
            assignee_user_id,
            project_id: self.project_id,
            due_after: self.due_after,
            due_before: self.due_before,
            updated_after: self.updated_after,
            updated_before: self.updated_before,
            search: self.search.clone(),
            sort,
        }
    }

    fn tag_filters(&self) -> &[TagFilter] {
        self.tags.as_deref().unwrap_or_default()
    }
}

#[async_trait]
impl<T, E> AsyncTool<SoupToolContext<T, E>> for ListTasks
where
    T: SoupService,
    E: EmailService,
{
    type Output = ListTasksResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SoupToolContext<T, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "List tasks");

        let current_user_id = request_context.user_id.to_string();
        let query = self.resolved_query(&current_user_id);
        let response_limit = self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

        let mut tag_sets: Option<CallerTagSets> = None;
        let tag_filter_expr = if self.tag_filters().is_empty() {
            None
        } else {
            let sets = fetch_caller_tag_sets(&service_context, &request_context).await?;
            let resolved = match self.tags_match {
                TagMatch::Any => {
                    sets.resolve_filters(self.tag_filters())
                        .map_err(|e| ToolCallError {
                            description: e.to_string(),
                            internal_error: anyhow::anyhow!(e),
                        })?
                }
                TagMatch::All => sets
                    .resolve_filters_unique(self.tag_filters())
                    .map_err(|e| ToolCallError {
                        description: e.to_string(),
                        internal_error: anyhow::anyhow!(e),
                    })?,
            };
            let combine = match self.tags_match {
                TagMatch::Any => Expr::or,
                TagMatch::All => Expr::and,
            };
            let expr = resolved
                .into_iter()
                .map(|option| {
                    Expr::val(PropertiesLiteral {
                        property_definition_id: option.definition_id,
                        entity_type: None,
                        value: PropertyMatchValue::SelectOption(option.option_id),
                    })
                })
                .reduce(combine);
            tag_sets = Some(sets);
            expr
        };

        let filters = query
            .entity_filter_ast(tag_filter_expr)
            .map_err(|description| ToolCallError {
                description,
                internal_error: anyhow::anyhow!("invalid ListTasks filter"),
            })?;

        let result = service_context
            .service
            .get_user_soup_with_properties(
                SoupRequest {
                    soup_type: SoupType::Expanded,
                    limit: query.soup_limit(response_limit),
                    cursor: SoupQuery::new_sort_simple(query.soup_sort_method(), filters),
                    sort_direction: SoupSortDirection::default(),
                    user: request_context.user_id.clone(),
                    email_preview_view: PreviewView::default(),
                    link_ids: Vec::new(),
                },
                None,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to list tasks: {e}"),
                internal_error: e.into(),
            })?;

        let paginated = result.type_erase();
        if tag_sets.is_none() && any_task_has_tags(&paginated.items) {
            tag_sets = Some(fetch_caller_tag_sets(&service_context, &request_context).await?);
        }
        let tag_map = tag_sets
            .map(|sets| sets.applied_tag_by_option_id())
            .unwrap_or_default();

        let mut tasks: Vec<TaskRecord> = paginated
            .items
            .into_iter()
            .filter_map(|EnrichedSoupItem { item, .. }| match item {
                SoupItem::Document(doc) => extract_task(&doc, &tag_map),
                _ => None,
            })
            .filter(|task| query.matches_in_memory(task))
            .collect();

        sort_tasks(&mut tasks, query.sort);

        let total_matching = tasks.len();
        tasks.truncate(usize::from(response_limit));
        let items: Vec<TaskListItem> = tasks.into_iter().map(to_list_item).collect();
        let summary = build_summary(&items, total_matching, query.sort);

        Ok(ListTasksResponse {
            tasks: items,
            summary,
        })
    }
}

fn to_list_item(task: TaskRecord) -> TaskListItem {
    TaskListItem {
        id: task.id,
        name: task.name,
        status: task.status.map(|status| TaskSelectValue {
            option_id: status.uuid(),
            label: status.display_value().to_string(),
        }),
        priority: task.priority.map(|priority| TaskSelectValue {
            option_id: priority.uuid(),
            label: priority.display_value().to_string(),
        }),
        assignees: task.assignees,
        due_date: task.due_date,
        project_id: task.project_id,
        tags: task.tags,
        created_at: task.created_at,
        updated_at: task.updated_at,
    }
}

fn any_task_has_tags(items: &[EnrichedSoupItem]) -> bool {
    items.iter().any(|EnrichedSoupItem { item, .. }| {
        let SoupItem::Document(doc) = item else {
            return false;
        };
        doc.extra
            .properties
            .iter()
            .any(|p| p.definition.data_type == models_properties::DataType::Tag)
    })
}

fn build_summary(items: &[TaskListItem], total_matching: usize, sort: TaskSort) -> String {
    let sort_label = match sort {
        TaskSort::RecentlyUpdated => "most recently updated",
        TaskSort::RecentlyViewed => "most recently viewed",
        TaskSort::RecentlyCreated => "most recently created",
        TaskSort::Priority => "priority (Urgent first)",
        TaskSort::Status => "status (Not Started first)",
        TaskSort::DueDate => "due date (soonest first)",
    };

    if items.is_empty() {
        return "No tasks match the given filters.".to_string();
    }
    if total_matching > items.len() {
        format!(
            "Showing {} of {} matching tasks, sorted by {sort_label}. Narrow the filters or raise limit.",
            items.len(),
            total_matching
        )
    } else {
        format!(
            "Found {} task{}, sorted by {sort_label}.",
            items.len(),
            if items.len() == 1 { "" } else { "s" }
        )
    }
}
