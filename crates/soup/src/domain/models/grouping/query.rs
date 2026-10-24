//! Grouped sort dispatch and frozen deadline continuation policy.

use item_filters::ast::{EntityFilterAst, ExpandErr};
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{Base64Str, CursorWithValAndFilter, DueDateSort, Query, SimpleSortMethod};
use uuid::Uuid;

use crate::domain::models::{
    SoupErr,
    due_date::{
        GroupedDueDateContext, GroupedDueDateCursor, GroupedDueDateRequest, validate_grouping,
    },
};

/// Timestamp cursor with frozen deadline grouping and task filters.
pub type GroupedTimestampCursor =
    CursorWithValAndFilter<Uuid, SimpleSortMethod, GroupedDueDateContext>;

/// Sorting supported by grouped Soup queries.
#[derive(Debug, Clone, Copy)]
pub enum GroupedSortMethod {
    /// Existing timestamp ordering.
    Timestamp(SimpleSortMethod),
    /// Task-only due-date ordering, with undated tasks last.
    DueDate(DueDateSort),
}

/// Grouped query dispatch without changing deployed timestamp cursor values.
#[derive(Debug)]
pub enum GroupedSortQuery<'a> {
    /// Timestamp-sorted groups, including deadline groups.
    Timestamp(GroupedSortRequest<'a>),
    /// Due-date-sorted task groups with contextual continuation cursors.
    DueDate(GroupedDueDateRequest<'a>),
}

impl<'a> GroupedSortQuery<'a> {
    /// Start a grouped page and normalize its page size once.
    pub fn initial(
        user_id: MacroUserIdStr<'a>,
        limit: u16,
        sort: GroupedSortMethod,
        filters: EntityFilterAst,
        mut grouping: GroupingConfig,
    ) -> Result<Self, SoupErr> {
        let limit = limit.clamp(1, 500);
        grouping.per_group_limit = Some(
            grouping
                .per_group_limit
                .unwrap_or(u32::from(limit))
                .clamp(1, 500),
        );
        validate_grouping(&grouping)?;
        match sort {
            GroupedSortMethod::Timestamp(sort) => Ok(Self::Timestamp(GroupedSortRequest::initial(
                user_id, limit, sort, filters, grouping,
            ))),
            GroupedSortMethod::DueDate(sort) => Ok(Self::DueDate(GroupedDueDateRequest::initial(
                user_id, limit, sort, filters, grouping,
            )?)),
        }
    }

    /// Decode a continuation without treating malformed context as legacy filters.
    pub fn continue_from(
        user_id: MacroUserIdStr<'a>,
        encoded: String,
        grouping: GroupingConfig,
    ) -> Result<Self, SoupErr> {
        let value = Base64Str::<serde_json::Value>::new_from_string(encoded)
            .decode_json()
            .map_err(|error| invalid_cursor(error.to_string()))?;
        let due_date = matches!(
            value
                .pointer("/val/sort_type")
                .and_then(serde_json::Value::as_str),
            Some("due_date_earliest" | "due_date_latest")
        );
        let contextual = value.pointer("/filter/grouping").is_some()
            || value.pointer("/filter/filters").is_some();
        if due_date {
            let cursor: GroupedDueDateCursor =
                serde_json::from_value(value).map_err(|error| invalid_cursor(error.to_string()))?;
            return Ok(Self::DueDate(GroupedDueDateRequest::continue_from(
                user_id,
                cursor,
                Some(grouping),
            )?));
        }
        if contextual {
            let cursor: GroupedTimestampCursor =
                serde_json::from_value(value).map_err(|error| invalid_cursor(error.to_string()))?;
            validate_context(&cursor.filter, Some(&grouping), cursor.limit)?;
            let limit = cursor.limit as u16;
            let frozen = cursor.filter.grouping.clone();
            return Ok(Self::Timestamp(GroupedSortRequest {
                user_id,
                limit,
                cursor: Query::Cursor(cursor.map_filter(|context| context.filters)),
                grouping: frozen,
            }));
        }
        let cursor =
            serde_json::from_value(value).map_err(|error| invalid_cursor(error.to_string()))?;
        Ok(Self::Timestamp(GroupedSortRequest::continue_from(
            user_id, cursor, grouping,
        )?))
    }
}

/// Parameters for timestamp-sorted grouped Soup queries.
#[derive(Debug)]
pub struct GroupedSortRequest<'a> {
    /// Maximum number of items in a continuation page.
    pub limit: u16,
    /// Timestamp sort, filters, and optional continuation.
    pub cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    /// Authenticated viewer.
    pub user_id: MacroUserIdStr<'a>,
    /// Group field, optional key, and initial per-group limit.
    pub grouping: GroupingConfig,
}

impl<'a> GroupedSortRequest<'a> {
    /// Start a timestamp-sorted grouped page.
    pub fn initial(
        user_id: MacroUserIdStr<'a>,
        limit: u16,
        sort: SimpleSortMethod,
        filters: EntityFilterAst,
        grouping: GroupingConfig,
    ) -> Self {
        Self {
            user_id,
            limit,
            cursor: Query::Sort(sort, filters),
            grouping,
        }
    }

    /// Continue a deployed legacy cursor; deadline groups require frozen context.
    pub fn continue_from(
        user_id: MacroUserIdStr<'a>,
        cursor: CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>,
        grouping: GroupingConfig,
    ) -> Result<Self, SoupErr> {
        if matches!(grouping.field, GroupByField::Deadline { .. }) {
            return Err(invalid_cursor(
                "deadline grouping requires a contextual cursor",
            ));
        }
        if !(1..=500).contains(&cursor.limit) {
            return Err(invalid_cursor(
                "grouped cursor limit must be between 1 and 500",
            ));
        }
        Ok(Self {
            user_id,
            limit: cursor.limit as u16,
            cursor: Query::Cursor(cursor),
            grouping,
        })
    }
}

/// Validate explicit continuation inputs against the frozen grouped context.
pub(crate) fn validate_context(
    context: &GroupedDueDateContext,
    supplied: Option<&GroupingConfig>,
    limit: usize,
) -> Result<(), SoupErr> {
    validate_grouping(&context.grouping)?;
    if !(1..=500).contains(&limit) {
        return Err(invalid_cursor(
            "grouped cursor limit must be between 1 and 500",
        ));
    }
    if context
        .grouping
        .per_group_limit
        .is_some_and(|value| value as usize != limit)
    {
        return Err(invalid_cursor(
            "grouped cursor limit conflicts with frozen context",
        ));
    }
    if context.grouping.group_key.is_none() {
        return Err(invalid_cursor("grouped continuation requires a group key"));
    }
    if let Some(supplied) = supplied
        && (supplied.field != context.grouping.field
            || supplied.group_key != context.grouping.group_key
            || supplied
                .per_group_limit
                .is_some_and(|value| value != context.grouping.effective_limit()))
    {
        return Err(invalid_cursor(
            "grouped cursor conflicts with grouping inputs",
        ));
    }
    Ok(())
}

fn invalid_cursor(message: impl Into<String>) -> SoupErr {
    SoupErr::AstErr(ExpandErr::ApiAst(message.into()))
}

#[cfg(test)]
mod test;
