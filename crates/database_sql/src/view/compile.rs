//! A view's query as the `SELECT` the engine runs, built without SQL text.

#[cfg(test)]
mod test;

use models_databases::views::{
    Conjunction, DatabaseView, DateOperator, DateRangeOperator, FilterCondition, FilterGroup,
    FilterNode, FilterTest, NumberOperator, PresenceOperator, SetOperator, SortDirection,
    TextOperator, ViewProblem,
};

use crate::catalog::{Catalog, Column, Table};
use crate::resolve::{
    Binding, ComparisonOperator, Direction, Filter, Order, OrderKey, Relation, SelectItem,
    SelectQuery, Value, row_position_key,
};

use super::{checked_table, placed};

/// The escape character of the `LIKE` patterns text tests become.
const LIKE_ESCAPE: char = '\\';

/// The `SELECT * … WHERE … ORDER BY …, row_position` a view shows, exactly as
/// [`resolve`](crate::resolve::resolve) would bind it.
pub fn compile_view(view: &DatabaseView, catalog: &Catalog) -> Result<SelectQuery, ViewProblem> {
    compile_checked(view, checked_table(view, catalog)?)
}

/// [`compile_view`] once the view has checked out against `table`.
pub(super) fn compile_checked(
    view: &DatabaseView,
    table: &Table,
) -> Result<SelectQuery, ViewProblem> {
    let position = row_position_key(table.id);
    let mut bindings: Vec<Binding> = table
        .columns
        .iter()
        .map(|column| Binding {
            key: column.id,
            relation: 0,
            column: Some(column.id),
        })
        .collect();
    bindings.push(Binding {
        key: position,
        relation: 0,
        column: None,
    });
    let order_by = view
        .query
        .sort
        .iter()
        .map(|key| {
            Ok(Order {
                key: OrderKey::Column(placed(table, key.column)?.id),
                direction: match key.direction {
                    SortDirection::Ascending => Direction::Ascending,
                    SortDirection::Descending => Direction::Descending,
                },
            })
        })
        .chain(std::iter::once(Ok(Order {
            key: OrderKey::Column(position),
            direction: Direction::Ascending,
        })))
        .collect::<Result<_, ViewProblem>>()?;
    let where_ = match &view.query.filter {
        Some(group) => group_filter(table, group)?,
        None => None,
    };
    Ok(SelectQuery {
        distinct: false,
        relations: vec![Relation {
            table: table.id,
            alias: table.name.clone(),
            source: table.source,
        }],
        joins: vec![],
        items: table
            .columns
            .iter()
            .map(|column| SelectItem::Column(column.id))
            .collect(),
        labels: vec![],
        where_,
        group_by: None,
        order_by,
        limit: None,
        offset: None,
        bindings,
    })
}

/// A group's filter; `None` when it keeps every row.
fn group_filter(table: &Table, group: &FilterGroup) -> Result<Option<Filter>, ViewProblem> {
    let mut parts = Vec::new();
    for node in &group.conditions {
        let part = match node {
            FilterNode::Condition(condition) => Some(condition_filter(table, condition)?),
            FilterNode::Group(group) => group_filter(table, group)?,
        };
        match (part, group.conjunction) {
            (Some(part), _) => parts.push(part),
            (None, Conjunction::And) => {}
            (None, Conjunction::Or) => return Ok(None),
        }
    }
    Ok(joined(group.conjunction, parts))
}

/// The parts under one conjunction: one part stands alone, none keeps every
/// row.
fn joined(conjunction: Conjunction, mut parts: Vec<Filter>) -> Option<Filter> {
    match (parts.len(), conjunction) {
        (0, _) => None,
        (1, _) => parts.pop(),
        (_, Conjunction::And) => Some(Filter::And(parts)),
        (_, Conjunction::Or) => Some(Filter::Or(parts)),
    }
}

fn condition_filter(table: &Table, condition: &FilterCondition) -> Result<Filter, ViewProblem> {
    let placed = placed(table, condition.column)?;
    let column = placed.id;
    let compare = |operator, value| Filter::Comparison {
        column,
        operator,
        value,
    };
    let or_empty = |filter| {
        Filter::Or(vec![
            filter,
            Filter::IsNull {
                column,
                negated: false,
            },
        ])
    };
    let like = |pattern, negated| Filter::Like {
        column,
        pattern,
        escape: Some(LIKE_ESCAPE),
        negated,
    };
    let filter = match &condition.test {
        FilterTest::Presence { operator } => Filter::IsNull {
            column,
            negated: *operator == PresenceOperator::IsNotEmpty,
        },
        FilterTest::Text { operator, value } => {
            let text = || Value::Text(value.clone());
            let literal = escaped(value);
            match operator {
                TextOperator::Is => compare(ComparisonOperator::Equal, text()),
                TextOperator::IsNot => or_empty(compare(ComparisonOperator::NotEqual, text())),
                TextOperator::Contains => like(format!("%{literal}%"), false),
                TextOperator::DoesNotContain => or_empty(like(format!("%{literal}%"), true)),
                TextOperator::StartsWith => like(format!("{literal}%"), false),
                TextOperator::EndsWith => like(format!("%{literal}"), false),
            }
        }
        FilterTest::Number { operator, value } => {
            let number = Value::Number(*value);
            match operator {
                NumberOperator::Is => compare(ComparisonOperator::Equal, number),
                NumberOperator::IsNot => or_empty(compare(ComparisonOperator::NotEqual, number)),
                NumberOperator::GreaterThan => compare(ComparisonOperator::Greater, number),
                NumberOperator::GreaterThanOrEqual => {
                    compare(ComparisonOperator::GreaterOrEqual, number)
                }
                NumberOperator::LessThan => compare(ComparisonOperator::Less, number),
                NumberOperator::LessThanOrEqual => compare(ComparisonOperator::LessOrEqual, number),
            }
        }
        FilterTest::Date { operator, value } => compare(
            match operator {
                DateOperator::Before => ComparisonOperator::Less,
                DateOperator::After => ComparisonOperator::Greater,
                DateOperator::OnOrBefore => ComparisonOperator::LessOrEqual,
                DateOperator::OnOrAfter => ComparisonOperator::GreaterOrEqual,
            },
            Value::Date(*value),
        ),
        // The test is of a whole day: a range compared to the day's first
        // instant tells whether it ends before it, and compared to its last
        // whether it starts after it.
        FilterTest::DateRange { operator, value } => {
            let first = Value::Date(*value);
            let last =
                Value::Date(*value + chrono::Duration::days(1) - chrono::Duration::microseconds(1));
            match operator {
                DateRangeOperator::Contains => Filter::And(vec![
                    compare(ComparisonOperator::GreaterOrEqual, first),
                    compare(ComparisonOperator::LessOrEqual, last),
                ]),
                DateRangeOperator::DoesNotContain => or_empty(Filter::Or(vec![
                    compare(ComparisonOperator::Less, first),
                    compare(ComparisonOperator::Greater, last),
                ])),
                DateRangeOperator::EndsBefore => compare(ComparisonOperator::Less, first),
                DateRangeOperator::EndsOnOrAfter => {
                    compare(ComparisonOperator::GreaterOrEqual, first)
                }
                DateRangeOperator::StartsAfter => compare(ComparisonOperator::Greater, last),
                DateRangeOperator::StartsOnOrBefore => {
                    compare(ComparisonOperator::LessOrEqual, last)
                }
            }
        }
        FilterTest::Checkbox { checked: true } => {
            compare(ComparisonOperator::Equal, Value::Bool(true))
        }
        FilterTest::Checkbox { checked: false } => {
            or_empty(compare(ComparisonOperator::Equal, Value::Bool(false)))
        }
        FilterTest::Options { operator, options } => set_filter(
            placed,
            *operator,
            options
                .iter()
                .map(|option| Value::Option(*option))
                .collect(),
        )?,
        FilterTest::Entities { operator, entities } => set_filter(
            placed,
            *operator,
            entities
                .iter()
                .map(|entity| Value::Entity(entity.clone()))
                .collect(),
        )?,
    };
    Ok(filter)
}

/// A set test. An absent multi-valued cell has no member, so `NOT HAS`
/// already keeps it; only `NOT IN` needs the empty cell named.
fn set_filter(
    placed: &Column,
    operator: SetOperator,
    values: Vec<Value>,
) -> Result<Filter, ViewProblem> {
    let column = placed.id;
    let has = |negated| {
        values
            .iter()
            .map(|value| Filter::Has {
                column,
                value: value.clone(),
                negated,
            })
            .collect::<Vec<_>>()
    };
    let members = match operator {
        SetOperator::IsAnyOf => {
            return Ok(Filter::In {
                column,
                values,
                negated: false,
            });
        }
        SetOperator::IsNoneOf => {
            return Ok(Filter::Or(vec![
                Filter::In {
                    column,
                    values,
                    negated: true,
                },
                Filter::IsNull {
                    column,
                    negated: false,
                },
            ]));
        }
        SetOperator::HasAny => joined(Conjunction::Or, has(false)),
        SetOperator::HasAll => joined(Conjunction::And, has(false)),
        SetOperator::HasNone => joined(Conjunction::And, has(true)),
    };
    members.ok_or_else(|| ViewProblem::NothingToMatch {
        column: placed.name.clone(),
    })
}

/// Text matched literally inside a `LIKE` pattern.
fn escaped(text: &str) -> String {
    let mut pattern = String::with_capacity(text.len());
    for character in text.chars() {
        if matches!(character, '%' | '_' | LIKE_ESCAPE) {
            pattern.push(LIKE_ESCAPE);
        }
        pattern.push(character);
    }
    pattern
}
