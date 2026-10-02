//! The one check of a view against its table, run by the server on every
//! view an op writes and by the engine on every view it compiles.

use std::collections::HashSet;

use serde::Serialize;

use crate::cast::CastKind;
use crate::ops::EntityKind;

use super::{FilterTest, LaneKey, SetOperator, ViewLayout, ViewQuery};
use crate::ids::{ColumnId, OptionId, TableId};

/// What a view's checks need to know of one column of its table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaColumn {
    /// The column placement.
    pub id: ColumnId,
    /// Its name, for messages.
    pub name: String,
    /// What it holds, as the cast rule reads it.
    pub kind: CastKind,
    /// The kind of value it holds.
    pub values: ValueKind,
    /// Whether a cell holds several values.
    pub multi: bool,
    /// Its options, for a select or tag column.
    pub options: Vec<OptionId>,
}

impl SchemaColumn {
    /// A column holding values of `kind`, several per cell when `multi`;
    /// `options` are kept only for a select, the one kind whose tests name
    /// options.
    pub fn new(
        id: ColumnId,
        name: String,
        kind: CastKind,
        multi: bool,
        options: Vec<OptionId>,
    ) -> Self {
        let values = kind.value_kind();
        SchemaColumn {
            id,
            name,
            kind,
            values,
            multi,
            options: if values == ValueKind::Options {
                options
            } else {
                Vec::new()
            },
        }
    }
}

/// The kind of value a column holds, as filter tests tell them apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type, strum::IntoStaticStr)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "lowercase")]
pub enum ValueKind {
    /// Text and links.
    Text,
    /// Numbers.
    Number,
    /// Date-times.
    Date,
    /// Checkboxes.
    Checkbox,
    /// Options of a select or tag column.
    Options,
    /// References to entities, or to related rows.
    Entities,
}

/// Why a view does not fit its table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ViewProblem {
    /// The view's table is not one the caller can see.
    #[error("no table {table} among the tables you can see")]
    UnknownTable {
        /// The table's id.
        table: TableId,
    },
    /// An id names no column of the table.
    #[error("no column {column} in this table")]
    UnknownColumn {
        /// The id.
        column: ColumnId,
    },
    /// An id names no option of the column.
    #[error("no option {option} on \"{column}\"")]
    UnknownOption {
        /// The column's name.
        column: String,
        /// The id.
        option: OptionId,
    },
    /// A test of one kind of value tests a column holding another.
    #[error("\"{column}\" holds {} values; a {} test does not fit it", <&str>::from(*holds), <&str>::from(*test))]
    TestDoesNotFit {
        /// The column's name.
        column: String,
        /// What it holds.
        holds: ValueKind,
        /// What the test tests.
        test: ValueKind,
    },
    /// A set test for one value tests a column holding several, or the
    /// other way around.
    #[error("{}", operator_misfit(column, *multi))]
    OperatorDoesNotFit {
        /// The column's name.
        column: String,
        /// Whether the column holds several values.
        multi: bool,
    },
    /// A set test names nothing to match.
    #[error("a test of \"{column}\" names nothing to match")]
    NothingToMatch {
        /// The column's name.
        column: String,
    },
    /// A number test compares against a number that is not finite.
    #[error("a test of \"{column}\" compares against a number that is not finite")]
    NotFinite {
        /// The column's name.
        column: String,
    },
    /// A column is listed twice where it may be listed once.
    #[error("\"{column}\" is listed twice")]
    RepeatedColumn {
        /// The column's name.
        column: String,
    },
    /// A lane is listed twice.
    #[error("a lane is listed twice")]
    RepeatedLane,
    /// A board was asked of a view laid out as a table.
    #[error("the view is not a board")]
    NotABoard,
    /// A board is grouped by a column that is neither a single select nor
    /// a single person.
    #[error(
        "a board is grouped by a single-select or single-person column, so each card has one \
         lane; \"{column}\" is neither"
    )]
    BoardCannotGroupBy {
        /// The column's name.
        column: String,
    },
    /// A lane names an option on a board grouped by people, or a person on
    /// one grouped by options.
    #[error("{}", lane_misfit(column, *people))]
    LaneDoesNotFit {
        /// The grouping column's name.
        column: String,
        /// Whether the column groups the board by people.
        people: bool,
    },
}

fn lane_misfit(column: &str, people: bool) -> String {
    if people {
        format!("\"{column}\" groups the board by person; a lane names a person, or no one")
    } else {
        format!("\"{column}\" groups the board by option; a lane names one of its options, or none")
    }
}

/// What a board's lanes are drawn from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Grouping {
    /// The options of a single select.
    Options,
    /// The people a single-person column names.
    People,
}

fn grouping(column: &SchemaColumn) -> Result<Grouping, ViewProblem> {
    match column.kind {
        CastKind::Select { multi: false } => Ok(Grouping::Options),
        CastKind::Entity {
            target: EntityKind::User,
            multi: false,
        } => Ok(Grouping::People),
        _ => Err(ViewProblem::BoardCannotGroupBy {
            column: column.name.clone(),
        }),
    }
}

/// Check that `lane` is a lane of a board grouped by `grouping_column`: the
/// column groups a board, and the lane names one of its options, a person
/// for a person column, or nothing.
pub fn check_lane(grouping_column: &SchemaColumn, lane: &LaneKey) -> Result<(), ViewProblem> {
    let grouping = grouping(grouping_column)?;
    match (grouping, lane) {
        (_, LaneKey::None) | (Grouping::People, LaneKey::User(_)) => Ok(()),
        (Grouping::Options, LaneKey::Option(option)) => known_option(grouping_column, *option),
        (Grouping::Options, LaneKey::User(_)) | (Grouping::People, LaneKey::Option(_)) => {
            Err(ViewProblem::LaneDoesNotFit {
                column: grouping_column.name.clone(),
                people: grouping == Grouping::People,
            })
        }
    }
}

fn operator_misfit(column: &str, multi: bool) -> String {
    if multi {
        format!("\"{column}\" holds several values; test it with hasAny, hasAll or hasNone")
    } else {
        format!("\"{column}\" holds one value; test it with isAnyOf or isNoneOf")
    }
}

/// Check a view's query and layout against the columns of its table.
pub fn check(
    query: &ViewQuery,
    layout: &ViewLayout,
    columns: &[SchemaColumn],
) -> Result<(), ViewProblem> {
    let column = |id: ColumnId| {
        columns
            .iter()
            .find(|column| column.id == id)
            .ok_or(ViewProblem::UnknownColumn { column: id })
    };
    for condition in query.filter.iter().flat_map(|group| group.conditions()) {
        check_test(column(condition.column)?, &condition.test)?;
    }
    distinct(query.sort.iter().map(|key| key.column), &column)?;
    match layout {
        ViewLayout::Table { columns: shown } => {
            distinct(shown.iter().map(|shown| shown.column), &column)?;
        }
        ViewLayout::Board {
            group_by,
            title,
            lanes,
            card_fields,
            ..
        } => {
            column(*title)?;
            let grouping_column = column(*group_by)?;
            grouping(grouping_column)?;
            let mut listed = HashSet::new();
            for lane in lanes {
                if !listed.insert(&lane.key) {
                    return Err(ViewProblem::RepeatedLane);
                }
                check_lane(grouping_column, &lane.key)?;
            }
            distinct(card_fields.iter().copied(), &column)?;
        }
    }
    Ok(())
}

fn check_test(column: &SchemaColumn, test: &FilterTest) -> Result<(), ViewProblem> {
    let fits = |test: ValueKind| {
        if column.values == test {
            Ok(())
        } else {
            Err(ViewProblem::TestDoesNotFit {
                column: column.name.clone(),
                holds: column.values,
                test,
            })
        }
    };
    match test {
        FilterTest::Presence { .. } => Ok(()),
        FilterTest::Text { .. } => fits(ValueKind::Text),
        FilterTest::Number { value, .. } => {
            fits(ValueKind::Number)?;
            if value.is_finite() {
                Ok(())
            } else {
                Err(ViewProblem::NotFinite {
                    column: column.name.clone(),
                })
            }
        }
        FilterTest::Date { .. } => fits(ValueKind::Date),
        FilterTest::Checkbox { .. } => fits(ValueKind::Checkbox),
        FilterTest::Options { operator, options } => {
            fits(ValueKind::Options)?;
            check_set(column, *operator, options.len())?;
            options
                .iter()
                .try_for_each(|option| known_option(column, *option))
        }
        FilterTest::Entities { operator, entities } => {
            fits(ValueKind::Entities)?;
            check_set(column, *operator, entities.len())
        }
    }
}

fn check_set(
    column: &SchemaColumn,
    operator: SetOperator,
    named: usize,
) -> Result<(), ViewProblem> {
    if operator.is_for_multiple_values() != column.multi {
        return Err(ViewProblem::OperatorDoesNotFit {
            column: column.name.clone(),
            multi: column.multi,
        });
    }
    if named == 0 {
        return Err(ViewProblem::NothingToMatch {
            column: column.name.clone(),
        });
    }
    Ok(())
}

fn known_option(column: &SchemaColumn, option: OptionId) -> Result<(), ViewProblem> {
    if column.options.contains(&option) {
        Ok(())
    } else {
        Err(ViewProblem::UnknownOption {
            column: column.name.clone(),
            option,
        })
    }
}

fn distinct<'a>(
    ids: impl Iterator<Item = ColumnId>,
    column: &impl Fn(ColumnId) -> Result<&'a SchemaColumn, ViewProblem>,
) -> Result<(), ViewProblem> {
    let mut seen = HashSet::new();
    for id in ids {
        let found = column(id)?;
        if !seen.insert(id) {
            return Err(ViewProblem::RepeatedColumn {
                column: found.name.clone(),
            });
        }
    }
    Ok(())
}
