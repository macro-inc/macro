//! Due-date task candidate contracts between the domain and repository.
use chrono::{DateTime, Utc};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{DueDateSort, Query};
use uuid::Uuid;

/// Canonical deadline read before pagination, never from hydrated properties.
#[derive(Debug, Clone)]
pub struct DueDateCandidate {
    /// Task id.
    pub id: Uuid,
    /// Deadline or absence of a deadline.
    pub due_at: Option<DateTime<Utc>>,
}

/// One task-only candidate page.
#[derive(Debug)]
pub struct DueDateRequest<'a> {
    /// Viewer.
    pub user_id: MacroUserIdStr<'a>,
    /// Page size.
    pub limit: u16,
    /// Sort, filters, and optional continuation.
    pub cursor: Query<Uuid, DueDateSort, EntityFilterAst>,
}

/// Frozen grouped cursor context. The group key and deadline boundaries travel
/// with the cursor, rather than being inferred from the next request's clock.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GroupedDueDateContext {
    /// Original task filters.
    pub filters: EntityFilterAst,
    /// Grouping field, key and limit fixed by the initial request.
    pub grouping: models_grouping::GroupingConfig,
}

/// A grouped cursor uses the same nullable due-date value as a flat cursor.
pub type GroupedDueDateCursor =
    models_pagination::CursorWithValAndFilter<Uuid, DueDateSort, GroupedDueDateContext>;

/// One authorized task and its placement in a due-date sorted group.
#[derive(Debug)]
pub struct DueDateGroupCandidate {
    /// Task id.
    pub id: Uuid,
    /// Canonical due date from candidate selection.
    pub due_at: Option<DateTime<Utc>>,
    /// Group membership key.
    pub key: String,
    /// Number of members before any cursor condition.
    pub total_group_count: usize,
    /// One-based position in this group before applying the cursor.
    pub index_in_group: usize,
}

/// Due-date grouped request; legacy timestamp grouped cursors stay unchanged.
#[derive(Debug)]
pub struct GroupedDueDateRequest<'a> {
    /// Viewer.
    pub user_id: MacroUserIdStr<'a>,
    /// Page limit in single-group continuation mode.
    pub limit: u16,
    /// Due-date sort, filter, and optional cursor.
    pub cursor: Query<Uuid, DueDateSort, EntityFilterAst>,
    /// Grouping configuration fixed at the initial page.
    pub grouping: models_grouping::GroupingConfig,
}

impl<'a> GroupedDueDateRequest<'a> {
    /// Start a grouped task page.
    pub fn initial(
        user_id: MacroUserIdStr<'a>,
        limit: u16,
        sort: DueDateSort,
        filters: EntityFilterAst,
        mut grouping: models_grouping::GroupingConfig,
    ) -> Result<Self, crate::domain::models::SoupErr> {
        let limit = limit.clamp(1, 500);
        grouping.per_group_limit = Some(
            grouping
                .per_group_limit
                .unwrap_or(u32::from(limit))
                .clamp(1, 500),
        );
        validate_grouping(&grouping)?;
        Ok(Self {
            user_id,
            limit,
            cursor: Query::Sort(sort, filters),
            grouping,
        })
    }

    /// Continue a group page with its frozen key and deadline boundaries.
    /// An explicitly supplied grouping configuration must match the cursor.
    pub fn continue_from(
        user_id: MacroUserIdStr<'a>,
        cursor: GroupedDueDateCursor,
        grouping: Option<models_grouping::GroupingConfig>,
    ) -> Result<Self, crate::domain::models::SoupErr> {
        super::grouping::query::validate_context(&cursor.filter, grouping.as_ref(), cursor.limit)?;
        let models_pagination::Cursor {
            id,
            limit,
            val,
            filter: context,
        } = cursor;
        Ok(Self {
            user_id,
            limit: limit.min(500) as u16,
            cursor: Query::Cursor(models_pagination::Cursor {
                id,
                limit,
                val,
                filter: context.filters,
            }),
            grouping: context.grouping,
        })
    }
}

fn invalid_grouping(message: &'static str) -> crate::domain::models::SoupErr {
    crate::domain::models::SoupErr::AstErr(item_filters::ast::ExpandErr::ApiAst(message.into()))
}

/// Reject invalid deadline boundaries before they reach SQL.
pub fn validate_grouping(
    grouping: &models_grouping::GroupingConfig,
) -> Result<(), crate::domain::models::SoupErr> {
    if let models_grouping::GroupByField::Deadline { boundaries } = grouping.field {
        if !boundaries.is_valid() {
            return Err(invalid_grouping("deadline boundaries must increase"));
        }
        if grouping.group_key.as_deref().is_some_and(|key| {
            !matches!(
                key,
                "" | "overdue" | "today" | "tomorrow" | "next_7_days" | "later"
            )
        }) {
            return Err(invalid_grouping("invalid deadline group key"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod test;
