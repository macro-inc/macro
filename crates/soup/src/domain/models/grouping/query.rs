//! Requests for ordinary timestamp grouping.

use item_filters::ast::{EntityFilterAst, ExpandErr};
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::GroupingConfig;
use models_pagination::{Base64Str, CursorWithValAndFilter, Query};
use uuid::Uuid;

use crate::domain::models::{DynamicSort, SoupErr};

/// Parameters for timestamp-sorted grouped Soup queries.
#[derive(Debug)]
pub struct GroupedSortRequest<'a> {
    /// Maximum number of items in a continuation page.
    pub limit: u16,
    /// Timestamp sort, filters, and optional continuation.
    pub cursor: Query<Uuid, DynamicSort, EntityFilterAst>,
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
        sort: impl Into<DynamicSort>,
        filters: EntityFilterAst,
        grouping: GroupingConfig,
    ) -> Self {
        Self {
            user_id,
            limit,
            cursor: Query::Sort(sort.into(), filters),
            grouping,
        }
    }

    /// Continue the deployed timestamp format with the caller's page size.
    pub fn continue_from(
        user_id: MacroUserIdStr<'a>,
        encoded: String,
        grouping: GroupingConfig,
        limit: Option<u16>,
    ) -> Result<Self, SoupErr> {
        let cursor: CursorWithValAndFilter<Uuid, DynamicSort, EntityFilterAst> =
            Base64Str::new_from_string(encoded)
                .decode_json()
                .map_err(|error| SoupErr::AstErr(ExpandErr::ApiAst(error.to_string())))?;
        let limit = limit.unwrap_or(cursor.limit.clamp(1, 500) as u16);
        Ok(Self {
            user_id,
            limit,
            cursor: Query::Cursor(cursor),
            grouping,
        })
    }
}

#[cfg(test)]
mod test;
