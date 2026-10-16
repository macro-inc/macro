//! A filter evaluated in memory against one set of cells, for a form's gate:
//! the answers are not a stored row, so nothing compiles to SQL.
//!
//! The semantics are a gate's, stricter than a view's about empty cells: an
//! empty cell (absent, [`CellValue::Clear`], blank text, or no members)
//! fails every test but [`PresenceOperator::IsEmpty`], negated tests
//! included, and every text test ignores case. Groups combine as a view's
//! do: a group without conditions keeps everything, so it drops out of an
//! AND and satisfies an OR. Options match by id only; a caller holding
//! options named by label resolves them against the column first.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use crate::ids::{ColumnId, OptionId};
use crate::ops::{CellValue, OptionRef};

use super::{
    Conjunction, DateOperator, FilterCondition, FilterGroup, FilterNode, FilterTest,
    NumberOperator, PresenceOperator, SetOperator, TextOperator,
};

/// Whether `cells` pass `group`. A group without conditions passes.
pub fn matches(group: &FilterGroup, cells: &HashMap<ColumnId, CellValue>) -> bool {
    group_verdict(group, cells).unwrap_or(true)
}

/// A group's verdict; `None` when it keeps everything.
fn group_verdict(group: &FilterGroup, cells: &HashMap<ColumnId, CellValue>) -> Option<bool> {
    let mut verdicts = Vec::with_capacity(group.conditions.len());
    for node in &group.conditions {
        let verdict = match node {
            FilterNode::Condition(condition) => Some(condition_holds(condition, cells)),
            FilterNode::Group(nested) => group_verdict(nested, cells),
        };
        match (verdict, group.conjunction) {
            (Some(verdict), _) => verdicts.push(verdict),
            (None, Conjunction::And) => {}
            (None, Conjunction::Or) => return None,
        }
    }
    if verdicts.is_empty() {
        return None;
    }
    Some(match group.conjunction {
        Conjunction::And => verdicts.into_iter().all(|verdict| verdict),
        Conjunction::Or => verdicts.into_iter().any(|verdict| verdict),
    })
}

/// Whether a value counts as an empty cell.
fn is_empty(value: &CellValue) -> bool {
    match value {
        CellValue::Clear => true,
        CellValue::Text(text) => text.trim().is_empty(),
        CellValue::Link(urls) => urls.is_empty(),
        CellValue::Options(options) => options.is_empty(),
        CellValue::Entities(references) => references.is_empty(),
        CellValue::Rows(rows) => rows.is_empty(),
        CellValue::Number(_) | CellValue::Boolean(_) | CellValue::Date(_) => false,
    }
}

fn condition_holds(condition: &FilterCondition, cells: &HashMap<ColumnId, CellValue>) -> bool {
    let cell = cells
        .get(&condition.column)
        .filter(|value| !is_empty(value));
    let Some(cell) = cell else {
        return matches!(
            condition.test,
            FilterTest::Presence {
                operator: PresenceOperator::IsEmpty
            }
        );
    };
    match &condition.test {
        FilterTest::Presence { operator } => *operator == PresenceOperator::IsNotEmpty,
        FilterTest::Text { operator, value } => text_holds(*operator, value, cell),
        FilterTest::Number { operator, value } => {
            let CellValue::Number(number) = cell else {
                return false;
            };
            match operator {
                NumberOperator::Is => number == value,
                NumberOperator::IsNot => number != value,
                NumberOperator::GreaterThan => number > value,
                NumberOperator::GreaterThanOrEqual => number >= value,
                NumberOperator::LessThan => number < value,
                NumberOperator::LessThanOrEqual => number <= value,
            }
        }
        FilterTest::Date { operator, value } => {
            let CellValue::Date(date) = cell else {
                return false;
            };
            match operator {
                DateOperator::Before => date < value,
                DateOperator::After => date > value,
                DateOperator::OnOrBefore => date <= value,
                DateOperator::OnOrAfter => date >= value,
            }
        }
        FilterTest::Checkbox { checked } => {
            matches!(cell, CellValue::Boolean(held) if held == checked)
        }
        FilterTest::Options { operator, options } => {
            let CellValue::Options(held) = cell else {
                return false;
            };
            let held: Vec<OptionId> = held
                .iter()
                .filter_map(|option| match option {
                    OptionRef::Id(id) => Some(*id),
                    OptionRef::Label(_) => None,
                })
                .collect();
            set_holds(*operator, &held, options)
        }
        FilterTest::Entities { operator, entities } => {
            let held: Vec<String> = match cell {
                CellValue::Entities(references) => references
                    .iter()
                    .map(|reference| reference.entity_id.clone())
                    .collect(),
                CellValue::Rows(rows) => rows.iter().map(ToString::to_string).collect(),
                _ => return false,
            };
            set_holds(*operator, &held, entities)
        }
    }
}

/// A text test against a text cell, or each URL of a link cell: a positive
/// test holds when one URL passes, a negated one when every URL does.
fn text_holds(operator: TextOperator, value: &str, cell: &CellValue) -> bool {
    let texts: Vec<&str> = match cell {
        CellValue::Text(text) => vec![text.as_str()],
        CellValue::Link(urls) => urls.iter().map(String::as_str).collect(),
        _ => return false,
    };
    let needle = value.to_lowercase();
    let passes = |text: &&str| {
        let text = text.to_lowercase();
        match operator {
            TextOperator::Is => text == needle,
            TextOperator::IsNot => text != needle,
            TextOperator::Contains => text.contains(&needle),
            TextOperator::DoesNotContain => !text.contains(&needle),
            TextOperator::StartsWith => text.starts_with(&needle),
            TextOperator::EndsWith => text.ends_with(&needle),
        }
    };
    match operator {
        TextOperator::IsNot | TextOperator::DoesNotContain => texts.iter().all(passes),
        TextOperator::Is
        | TextOperator::Contains
        | TextOperator::StartsWith
        | TextOperator::EndsWith => texts.iter().any(passes),
    }
}

/// A set test of a nonempty cell's members against the named ones.
fn set_holds<Member: PartialEq>(operator: SetOperator, held: &[Member], named: &[Member]) -> bool {
    let named_held = |name: &Member| held.contains(name);
    match operator {
        SetOperator::IsAnyOf | SetOperator::HasAny => named.iter().any(named_held),
        SetOperator::IsNoneOf | SetOperator::HasNone => !named.iter().any(named_held),
        SetOperator::HasAll => named.iter().all(named_held),
    }
}
