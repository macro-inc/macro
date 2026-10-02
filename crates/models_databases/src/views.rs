//! Views: saved, typed ways of looking at one table (a filter, a sort and a
//! table or board layout), referring to everything by id.

mod check;
mod lane_key;
mod lanes;
#[cfg(test)]
mod test;

pub use crate::ids::ViewId;
use crate::ids::{ColumnId, DatabaseId, OptionId, RowId, TableId};
use crate::position::Position;
use chrono::{DateTime, SubsecRound, Utc};
use serde::{Deserialize, Serialize};

pub use check::{SchemaColumn, ValueKind, ViewProblem, check, check_lane};
pub use lane_key::LaneKey;
pub use lanes::{PlacementError, arrange_lane, place_card};

/// When a view is written: now, to the microsecond, as a stored timestamp
/// keeps it, so a view answered from a write equals the view read back.
pub fn written_at() -> DateTime<Utc> {
    Utc::now().trunc_subsecs(6)
}

/// A view of one table, as stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseView {
    /// The view.
    #[schema(value_type = Uuid)]
    pub id: ViewId,
    /// The database the table belongs to.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The table it shows.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// Its name, unique among the table's views ignoring case.
    pub name: String,
    /// Where it sorts among the table's views: a fractional key.
    #[schema(value_type = String)]
    pub position: Position,
    /// Which rows it shows, in what order.
    pub query: ViewQuery,
    /// How it draws them.
    pub layout: ViewLayout,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// When it last changed.
    pub updated_at: DateTime<Utc>,
}

/// A view's contents as an op creates it; the server gives it its id,
/// position and times.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct NewView {
    /// Its name.
    pub name: String,
    /// Which rows it shows, in what order.
    #[serde(default)]
    pub query: ViewQuery,
    /// How it draws them; a board left without a card title gets the
    /// table's first column.
    pub layout: RequestedLayout,
}

/// Which rows of the table a view shows, and in what order: a filter and a
/// sort, nothing that joins, groups or reshapes rows.
#[derive(
    Debug, Clone, PartialEq, Default, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ViewQuery {
    /// The rows shown; every row when there is none.
    #[serde(default)]
    #[schema(required = true)]
    pub filter: Option<FilterGroup>,
    /// The sort keys, first key first. Rows the keys leave tied keep the
    /// table's own order; with no keys, the table's order is the view's.
    #[serde(default)]
    pub sort: Vec<SortKey>,
}

/// One sort key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SortKey {
    /// The column sorted on.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// Which way.
    pub direction: SortDirection,
}

/// A sort direction. Empty cells sort last either way.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    /// Smallest, earliest, first option first.
    Ascending,
    /// Largest, latest, last option first.
    Descending,
}

/// Conditions joined by one conjunction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct FilterGroup {
    /// Whether every condition must hold, or any one.
    pub conjunction: Conjunction,
    /// The conditions and nested groups. A group without any keeps every
    /// row.
    pub conditions: Vec<FilterNode>,
}

/// How a group's conditions combine.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum Conjunction {
    /// Every condition holds.
    And,
    /// At least one condition holds.
    Or,
}

/// One entry of a group: a condition, or a group of its own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilterNode {
    /// A test of one column.
    Condition(FilterCondition),
    /// A nested group.
    #[schema(no_recursion)]
    Group(FilterGroup),
}

/// A test of one column's cells.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    /// The column tested.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// What its cell must be. The test's kind must fit the column's type.
    pub test: FilterTest,
}

/// What a column's cell must be, by the kind of value the column holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilterTest {
    /// Whether the cell is empty; fits a column of any type.
    Presence {
        /// Empty, or not.
        operator: PresenceOperator,
    },
    /// A text or link column.
    Text {
        /// How the cell compares.
        operator: TextOperator,
        /// The text compared against, ignoring case for the containment
        /// tests.
        value: String,
    },
    /// A number column.
    Number {
        /// How the cell compares.
        operator: NumberOperator,
        /// The number compared against; finite.
        value: f64,
    },
    /// A date column.
    Date {
        /// How the cell compares.
        operator: DateOperator,
        /// The date-time compared against.
        value: DateTime<Utc>,
    },
    /// A checkbox column. An unchecked box and an empty cell are the same.
    Checkbox {
        /// Whether the box is checked.
        checked: bool,
    },
    /// A select or tag column.
    Options {
        /// How the cell's options relate to these.
        operator: SetOperator,
        /// Options of the column; at least one.
        #[schema(value_type = Vec<Uuid>)]
        options: Vec<OptionId>,
    },
    /// A reference or relation column.
    Entities {
        /// How the cell's references relate to these.
        operator: SetOperator,
        /// Entity ids, or for a relation the related rows' ids; at least
        /// one.
        entities: Vec<String>,
    },
}

/// Whether a cell is empty.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum PresenceOperator {
    /// The cell holds nothing.
    IsEmpty,
    /// The cell holds something.
    IsNotEmpty,
}

/// How a text cell compares to a text.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum TextOperator {
    /// Equal to it.
    Is,
    /// Anything else, an empty cell included.
    IsNot,
    /// Holds it somewhere.
    Contains,
    /// Does not hold it, an empty cell included.
    DoesNotContain,
    /// Begins with it.
    StartsWith,
    /// Ends with it.
    EndsWith,
}

/// How a number cell compares to a number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum NumberOperator {
    /// Equal to it.
    Is,
    /// Anything else, an empty cell included.
    IsNot,
    /// Greater than it.
    GreaterThan,
    /// Greater than or equal to it.
    GreaterThanOrEqual,
    /// Less than it.
    LessThan,
    /// Less than or equal to it.
    LessThanOrEqual,
}

/// How a date cell compares to a date-time.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum DateOperator {
    /// Strictly before it.
    Before,
    /// Strictly after it.
    After,
    /// At it or before.
    OnOrBefore,
    /// At it or after.
    OnOrAfter,
}

/// How a cell's options or references relate to a set of them. The first
/// two fit a column holding one value, the last three one holding several.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum SetOperator {
    /// The cell's value is one of them.
    IsAnyOf,
    /// The cell's value is none of them, an empty cell included.
    IsNoneOf,
    /// The cell holds at least one of them.
    HasAny,
    /// The cell holds every one of them.
    HasAll,
    /// The cell holds none of them.
    HasNone,
}

impl SetOperator {
    /// Whether the operator tests a column holding several values.
    pub fn is_for_multiple_values(self) -> bool {
        matches!(
            self,
            SetOperator::HasAny | SetOperator::HasAll | SetOperator::HasNone
        )
    }
}

/// How a view draws its rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ViewLayout {
    /// A grid with a row per row.
    Table {
        /// How columns show, in display order. A column left out shows
        /// after the listed ones, in the table's order.
        columns: Vec<ViewColumn>,
    },
    /// Cards in lanes: one lane per option of a single-select column, or
    /// one per person a single-person column names, plus one for cards
    /// with an empty cell. A multi-valued column cannot group a board: a
    /// card is in exactly one lane, so a card in several would need a place
    /// in each.
    #[serde(rename_all = "camelCase")]
    Board {
        /// The single-select or single-person column whose values are the
        /// lanes; moving a card to another lane sets this column.
        #[schema(value_type = Uuid)]
        group_by: ColumnId,
        /// The column a card is titled by, of any type. Removing it titles
        /// the cards by the table's first remaining column.
        #[schema(value_type = Uuid)]
        title: ColumnId,
        /// How lanes show, in display order. A lane left out shows after the
        /// listed ones: the lane of empty cells first, then options in the
        /// column's order, or people by id.
        lanes: Vec<Lane>,
        /// The columns a card shows under its title, in order.
        #[schema(value_type = Vec<Uuid>)]
        card_fields: Vec<ColumnId>,
        /// Whether a lane with no cards is hidden.
        hide_empty_lanes: bool,
    },
}

/// A layout as an op asks for it: a board may leave its card title out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestedLayout {
    /// A grid with a row per row.
    Table {
        /// How columns show, in display order. A column left out shows
        /// after the listed ones, in the table's order.
        columns: Vec<ViewColumn>,
    },
    /// Cards in lanes, one per option of a single-select column or per
    /// person of a single-person column, plus one for empty cells.
    #[serde(rename_all = "camelCase")]
    Board {
        /// The single-select or single-person column whose values are the
        /// lanes.
        #[schema(value_type = Uuid)]
        group_by: ColumnId,
        /// The column a card is titled by. Left out, a board keeps the
        /// title it has, and a new board takes the table's first column.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(value_type = Option<Uuid>, nullable = false)]
        #[specta(optional)]
        title: Option<ColumnId>,
        /// How lanes show, in display order.
        lanes: Vec<Lane>,
        /// The columns a card shows under its title, in order.
        #[schema(value_type = Vec<Uuid>)]
        card_fields: Vec<ColumnId>,
        /// Whether a lane with no cards is hidden.
        hide_empty_lanes: bool,
    },
}

impl RequestedLayout {
    /// The layout to store: a board without a title takes `default_title`,
    /// or answers `None` when there is none to take.
    pub fn with_default_title(self, default_title: Option<ColumnId>) -> Option<ViewLayout> {
        match self {
            RequestedLayout::Table { columns } => Some(ViewLayout::Table { columns }),
            RequestedLayout::Board {
                group_by,
                title,
                lanes,
                card_fields,
                hide_empty_lanes,
            } => Some(ViewLayout::Board {
                group_by,
                title: title.or(default_title)?,
                lanes,
                card_fields,
                hide_empty_lanes,
            }),
        }
    }
}

impl From<ViewLayout> for RequestedLayout {
    fn from(layout: ViewLayout) -> Self {
        match layout {
            ViewLayout::Table { columns } => RequestedLayout::Table { columns },
            ViewLayout::Board {
                group_by,
                title,
                lanes,
                card_fields,
                hide_empty_lanes,
            } => RequestedLayout::Board {
                group_by,
                title: Some(title),
                lanes,
                card_fields,
                hide_empty_lanes,
            },
        }
    }
}

/// How one column shows in a table layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ViewColumn {
    /// The column.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// Its width in pixels; the default when unset.
    #[serde(default)]
    #[schema(required = true)]
    pub width: Option<u32>,
}

/// How one lane shows in a board layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    /// The lane.
    pub key: LaneKey,
    /// Whether it is hidden.
    #[serde(default)]
    pub hidden: bool,
}

/// Where one card sits on a board: its lane, and its fractional key there.
/// A card whose row has since moved to another lane has no place until it is
/// moved again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct CardPosition {
    /// The card's row.
    #[schema(value_type = Uuid)]
    pub row: RowId,
    /// The lane.
    pub lane: LaneKey,
    /// The card's key in that lane.
    #[schema(value_type = String)]
    pub position: Position,
}

/// A view's place among its table's views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ViewPosition {
    /// The view.
    #[schema(value_type = Uuid)]
    pub view: ViewId,
    /// Its key.
    #[schema(value_type = String)]
    pub position: Position,
}

impl ViewQuery {
    /// The query without anything referring to `column`: its conditions and
    /// sort key. A group left without conditions goes with them.
    pub fn without_column(&self, column: ColumnId) -> ViewQuery {
        ViewQuery {
            sort: self
                .sort
                .iter()
                .filter(|key| key.column != column)
                .cloned()
                .collect(),
            ..self.without_tests_of(column)
        }
    }

    /// The query without its conditions on `column`, for a column whose
    /// values change type: a test of the old values fits the new ones no
    /// more. Its sort key stays.
    pub fn without_tests_of(&self, column: ColumnId) -> ViewQuery {
        ViewQuery {
            filter: self
                .filter
                .as_ref()
                .and_then(|group| group.retain(&|condition| condition.column != column)),
            sort: self.sort.clone(),
        }
    }

    /// The query without `option` of `column`: conditions on that column
    /// stop naming it, and a condition left naming nothing goes.
    pub fn without_option(&self, column: ColumnId, option: OptionId) -> ViewQuery {
        let filter = self.filter.as_ref().and_then(|group| {
            group.map_conditions(&|condition| {
                let FilterTest::Options { operator, options } = &condition.test else {
                    return Some(condition.clone());
                };
                if condition.column != column {
                    return Some(condition.clone());
                }
                let options: Vec<OptionId> = options
                    .iter()
                    .copied()
                    .filter(|named| *named != option)
                    .collect();
                (!options.is_empty()).then_some(FilterCondition {
                    column,
                    test: FilterTest::Options {
                        operator: *operator,
                        options,
                    },
                })
            })
        });
        ViewQuery {
            filter,
            sort: self.sort.clone(),
        }
    }
}

impl FilterGroup {
    /// The group keeping only the conditions `keep` accepts; `None` when
    /// nothing is left.
    fn retain(&self, keep: &impl Fn(&FilterCondition) -> bool) -> Option<FilterGroup> {
        self.map_conditions(&|condition| keep(condition).then(|| condition.clone()))
    }

    /// The group with every condition replaced by what `map` makes of it,
    /// dropping those it makes nothing of; `None` when nothing is left.
    fn map_conditions(
        &self,
        map: &impl Fn(&FilterCondition) -> Option<FilterCondition>,
    ) -> Option<FilterGroup> {
        let conditions: Vec<FilterNode> = self
            .conditions
            .iter()
            .filter_map(|node| match node {
                FilterNode::Condition(condition) => map(condition).map(FilterNode::Condition),
                FilterNode::Group(group) => group.map_conditions(map).map(FilterNode::Group),
            })
            .collect();
        (!conditions.is_empty()).then_some(FilterGroup {
            conjunction: self.conjunction,
            conditions,
        })
    }

    /// Every condition of the group and its nested groups.
    pub fn conditions(&self) -> Vec<&FilterCondition> {
        self.conditions
            .iter()
            .flat_map(|node| match node {
                FilterNode::Condition(condition) => vec![condition],
                FilterNode::Group(group) => group.conditions(),
            })
            .collect()
    }
}

impl ViewLayout {
    /// The layout without `column` among its columns or card fields. A
    /// board titled by it is titled by `next_title` instead, the table's
    /// first column once `column` is gone. A board grouped by it has
    /// nothing to fall back on, so it answers `None`: the view goes before
    /// the column can.
    pub fn without_column(
        &self,
        column: ColumnId,
        next_title: Option<ColumnId>,
    ) -> Option<ViewLayout> {
        match self {
            ViewLayout::Table { columns } => Some(ViewLayout::Table {
                columns: columns
                    .iter()
                    .filter(|shown| shown.column != column)
                    .cloned()
                    .collect(),
            }),
            ViewLayout::Board { group_by, .. } if *group_by == column => None,
            ViewLayout::Board {
                group_by,
                title,
                lanes,
                card_fields,
                hide_empty_lanes,
            } => Some(ViewLayout::Board {
                group_by: *group_by,
                title: if *title == column {
                    next_title?
                } else {
                    *title
                },
                lanes: lanes.clone(),
                card_fields: card_fields
                    .iter()
                    .copied()
                    .filter(|field| *field != column)
                    .collect(),
                hide_empty_lanes: *hide_empty_lanes,
            }),
        }
    }

    /// The layout without the lane of `option` of `column`.
    pub fn without_option(&self, column: ColumnId, option: OptionId) -> ViewLayout {
        match self {
            ViewLayout::Board {
                group_by,
                title,
                lanes,
                card_fields,
                hide_empty_lanes,
            } if *group_by == column => ViewLayout::Board {
                group_by: *group_by,
                title: *title,
                lanes: lanes
                    .iter()
                    .filter(|lane| lane.key != LaneKey::Option(option))
                    .cloned()
                    .collect(),
                card_fields: card_fields.clone(),
                hide_empty_lanes: *hide_empty_lanes,
            },
            other => other.clone(),
        }
    }

    /// The board's grouping column, for a board.
    pub fn group_by(&self) -> Option<ColumnId> {
        match self {
            ViewLayout::Board { group_by, .. } => Some(*group_by),
            ViewLayout::Table { .. } => None,
        }
    }

    /// The board's card title column, for a board.
    pub fn title(&self) -> Option<ColumnId> {
        match self {
            ViewLayout::Board { title, .. } => Some(*title),
            ViewLayout::Table { .. } => None,
        }
    }
}
