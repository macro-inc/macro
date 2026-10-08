//! Typed GraphQL inputs mapped to the existing database view model.

use async_graphql::{Enum, ID, InputObject, OneofObject};
use chrono::{DateTime, Utc};
use databases_sql::view_rows::{VIEW_PAGE_LIMIT, ViewRowsRequest};
use graphql_common::parse_id;
use models_databases::{ColumnId, OptionId, TableId, views as model};

/// A table view and its optional continuation, with a bounded page size.
#[derive(InputObject)]
pub struct DatabaseViewRowsInput {
    /// The table within the authorized database.
    table_id: ID,
    /// The complete filtering and ordering definition.
    query: DatabaseViewQueryInput,
    /// The preceding page’s opaque cursor; omit for the first page.
    cursor: Option<String>,
    /// Page size from 1 through 500; defaults to 500.
    limit: Option<u16>,
}

impl DatabaseViewRowsInput {
    pub(crate) fn into_request(self) -> async_graphql::Result<ViewRowsRequest> {
        Ok(ViewRowsRequest {
            table_id: TableId::from_uuid(parse_id(self.table_id, "tableId")?),
            query: self.query.into_model()?,
            cursor: self.cursor,
            limit: self.limit.unwrap_or(VIEW_PAGE_LIMIT),
        })
    }
}

/// Filtering and ordering applied to the entire table before pagination.
#[derive(InputObject)]
struct DatabaseViewQueryInput {
    /// Optional filter; omission includes every row.
    filter: Option<DatabaseViewFilterGroup>,
    #[graphql(default)]
    /// Ordering keys in priority order; omission uses manual row order.
    sort: Vec<DatabaseViewSort>,
}

impl DatabaseViewQueryInput {
    fn into_model(self) -> async_graphql::Result<model::ViewQuery> {
        Ok(model::ViewQuery {
            filter: self.filter.map(|filter| filter.into_model(0)).transpose()?,
            sort: self
                .sort
                .into_iter()
                .map(|sort| {
                    Ok(model::SortKey {
                        column: ColumnId::from_uuid(parse_id(sort.column, "column")?),
                        direction: sort.direction.into(),
                    })
                })
                .collect::<async_graphql::Result<_>>()?,
        })
    }
}

/// One ordering key; earlier keys take precedence.
#[derive(InputObject)]
struct DatabaseViewSort {
    /// Column placement identity within the selected table.
    column: ID,
    /// Ascending or descending value order.
    direction: DatabaseViewSortDirection,
}

/// The direction of a view ordering key.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::SortDirection")]
enum DatabaseViewSortDirection {
    /// Order values from lowest to highest.
    Ascending,
    /// Order values from highest to lowest.
    Descending,
}

/// How the conditions within a filter group combine.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::Conjunction")]
enum DatabaseViewConjunction {
    /// Require every condition.
    And,
    /// Require at least one condition.
    Or,
}

/// A conjunction of column conditions or nested groups.
#[derive(InputObject)]
struct DatabaseViewFilterGroup {
    /// Require every condition or at least one condition.
    conjunction: DatabaseViewConjunction,
    /// Column tests or nested groups.
    conditions: Vec<DatabaseViewFilterNode>,
}

/// Exactly one column condition or nested filter group.
#[derive(OneofObject)]
enum DatabaseViewFilterNode {
    /// A predicate on one column.
    Condition(DatabaseViewFilterCondition),
    /// A nested group of predicates.
    Group(DatabaseViewFilterGroup),
}

/// A typed predicate on one column placement.
#[derive(InputObject)]
struct DatabaseViewFilterCondition {
    /// Column placement identity within the selected table.
    column: ID,
    /// The comparison appropriate for this column.
    test: DatabaseViewFilterTest,
}

impl DatabaseViewFilterGroup {
    fn into_model(self, depth: u8) -> async_graphql::Result<model::FilterGroup> {
        if depth > 16 || self.conditions.len() > 100 {
            return Err(async_graphql::Error::new(
                "database view filter is too complex",
            ));
        }
        Ok(model::FilterGroup {
            conjunction: self.conjunction.into(),
            conditions: self
                .conditions
                .into_iter()
                .map(|node| match node {
                    DatabaseViewFilterNode::Group(group) => {
                        group.into_model(depth + 1).map(model::FilterNode::Group)
                    }
                    DatabaseViewFilterNode::Condition(condition) => {
                        Ok(model::FilterNode::Condition(model::FilterCondition {
                            column: ColumnId::from_uuid(parse_id(condition.column, "column")?),
                            test: condition.test.into_model()?,
                        }))
                    }
                })
                .collect::<async_graphql::Result<_>>()?,
        })
    }
}

/// Exactly one test compatible with the selected column type.
#[derive(OneofObject)]
enum DatabaseViewFilterTest {
    /// Test cell emptiness.
    Presence(DatabaseViewPresenceTest),
    /// Test a text or link cell.
    Text(DatabaseViewTextTest),
    /// Test a numeric cell.
    Number(DatabaseViewNumberTest),
    /// Test a date cell.
    Date(DatabaseViewDateTest),
    /// Test a checkbox cell.
    Checkbox(DatabaseViewCheckboxTest),
    /// Test selected option identities.
    Options(DatabaseViewOptionsTest),
    /// Test referenced entity identities.
    Entities(DatabaseViewEntitiesTest),
}

/// Test whether the cell has a value.
#[derive(InputObject)]
struct DatabaseViewPresenceTest {
    /// The comparison to apply.
    operator: DatabaseViewPresenceOperator,
}
/// Compare a text or link cell with a string.
#[derive(InputObject)]
struct DatabaseViewTextTest {
    /// The comparison to apply.
    operator: DatabaseViewTextOperator,
    /// The value to compare the cell against.
    value: String,
}
/// Compare a numeric cell with a finite number.
#[derive(InputObject)]
struct DatabaseViewNumberTest {
    /// The comparison to apply.
    operator: DatabaseViewNumberOperator,
    /// The value to compare the cell against.
    value: f64,
}
/// Compare a date cell with a UTC instant.
#[derive(InputObject)]
struct DatabaseViewDateTest {
    /// The comparison to apply.
    operator: DatabaseViewDateOperator,
    /// The value to compare the cell against.
    value: DateTime<Utc>,
}
/// Match the checked or unchecked state of a cell.
#[derive(InputObject)]
struct DatabaseViewCheckboxTest {
    /// Whether the cell must be checked.
    checked: bool,
}
/// Compare selected option identities with a set of options.
#[derive(InputObject)]
struct DatabaseViewOptionsTest {
    /// The comparison to apply.
    operator: DatabaseViewSetOperator,
    /// Option identities from the selected column.
    options: Vec<ID>,
}
/// Compare referenced entity identities with a set of entities.
#[derive(InputObject)]
struct DatabaseViewEntitiesTest {
    /// The comparison to apply.
    operator: DatabaseViewSetOperator,
    /// Referenced entity identities.
    entities: Vec<String>,
}

/// The requested cell-presence condition.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::PresenceOperator")]
enum DatabaseViewPresenceOperator {
    /// The cell has no value.
    IsEmpty,
    /// The cell has a value.
    IsNotEmpty,
}
/// A text equality or substring comparison.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::TextOperator")]
enum DatabaseViewTextOperator {
    /// The value equals the comparison value.
    Is,
    /// The value differs from the comparison value.
    IsNot,
    /// The text contains the comparison string.
    Contains,
    /// The text does not contain the comparison string.
    DoesNotContain,
    /// The text starts with the comparison string.
    StartsWith,
    /// The text ends with the comparison string.
    EndsWith,
}
/// A numeric equality or ordering comparison.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::NumberOperator")]
enum DatabaseViewNumberOperator {
    /// The value equals the comparison value.
    Is,
    /// The value differs from the comparison value.
    IsNot,
    /// The number is greater than the comparison value.
    GreaterThan,
    /// The number is at least the comparison value.
    GreaterThanOrEqual,
    /// The number is less than the comparison value.
    LessThan,
    /// The number is at most the comparison value.
    LessThanOrEqual,
}
/// An ordering comparison between instants.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::DateOperator")]
enum DatabaseViewDateOperator {
    /// The instant is before the comparison instant.
    Before,
    /// The instant is after the comparison instant.
    After,
    /// The instant is at or before the comparison instant.
    OnOrBefore,
    /// The instant is at or after the comparison instant.
    OnOrAfter,
}
/// A membership condition for single- or multi-valued cells.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "model::SetOperator")]
enum DatabaseViewSetOperator {
    /// The single-valued cell matches one supplied identity.
    IsAnyOf,
    /// The single-valued cell matches no supplied identity.
    IsNoneOf,
    /// The cell contains at least one supplied identity.
    HasAny,
    /// The cell contains every supplied identity.
    HasAll,
    /// The cell contains no supplied identity.
    HasNone,
}

impl DatabaseViewFilterTest {
    fn into_model(self) -> async_graphql::Result<model::FilterTest> {
        Ok(match self {
            Self::Presence(test) => model::FilterTest::Presence {
                operator: test.operator.into(),
            },
            Self::Text(test) => model::FilterTest::Text {
                operator: test.operator.into(),
                value: test.value,
            },
            Self::Number(test) => model::FilterTest::Number {
                operator: test.operator.into(),
                value: test.value,
            },
            Self::Date(test) => model::FilterTest::Date {
                operator: test.operator.into(),
                value: test.value,
            },
            Self::Checkbox(test) => model::FilterTest::Checkbox {
                checked: test.checked,
            },
            Self::Options(test) => model::FilterTest::Options {
                operator: test.operator.into(),
                options: test
                    .options
                    .into_iter()
                    .map(|id| parse_id(id, "option").map(OptionId::from_uuid))
                    .collect::<async_graphql::Result<_>>()?,
            },
            Self::Entities(test) => model::FilterTest::Entities {
                operator: test.operator.into(),
                entities: test.entities,
            },
        })
    }
}
