//! Evaluating the residual filter on one row.

use std::cmp::Ordering;

use models_databases::RowId;

use crate::resolve::{ComparisonOperator, Filter, Value};

use super::{Cell, Row};

/// Whether the row satisfies the filter. An empty cell fails every
/// comparison, as `NULL` does in SQL; `IS NULL` is the only test it passes.
pub fn holds(filter: &Filter, row: &Row) -> bool {
    match filter {
        Filter::And(parts) => parts.iter().all(|part| holds(part, row)),
        Filter::Or(parts) => parts.iter().any(|part| holds(part, row)),
        Filter::IsNull { column, negated } => {
            let empty = row.cells.get(column).is_none_or(Cell::is_empty);
            empty != *negated
        }
        Filter::Comparison {
            column,
            operator,
            value,
        } => row
            .cells
            .get(column)
            .and_then(|cell| compare(cell, value))
            .is_some_and(|ordering| match operator {
                ComparisonOperator::Equal => ordering == Ordering::Equal,
                ComparisonOperator::NotEqual => ordering != Ordering::Equal,
                ComparisonOperator::Less => ordering == Ordering::Less,
                ComparisonOperator::LessOrEqual => ordering != Ordering::Greater,
                ComparisonOperator::Greater => ordering == Ordering::Greater,
                ComparisonOperator::GreaterOrEqual => ordering != Ordering::Less,
            }),
        Filter::In {
            column,
            values,
            negated,
        } => row.cells.get(column).is_some_and(|cell| {
            let listed = values
                .iter()
                .any(|value| compare(cell, value) == Some(Ordering::Equal));
            listed != *negated
        }),
        Filter::Has {
            column,
            value,
            negated,
        } => {
            let has = match (row.cells.get(column), value) {
                (Some(Cell::Options(ids)), Value::Option(id)) => ids.contains(id),
                (Some(Cell::Entities(ids)), Value::Entity(id)) => ids.contains(id),
                _ => false,
            };
            has != *negated
        }
        Filter::Like {
            column,
            pattern,
            escape,
            negated,
        } => match row.cells.get(column) {
            Some(Cell::Text(text)) => like(pattern, *escape, text) != *negated,
            _ => false,
        },
    }
}

/// Order a cell against a typed value; `None` when they are not comparable,
/// which resolve rules out except for empty multi-valued cells.
fn compare(cell: &Cell, value: &Value) -> Option<Ordering> {
    match (cell, value) {
        (Cell::Text(text), Value::Text(other)) => Some(text.as_str().cmp(other.as_str())),
        (Cell::Number(number), Value::Number(other)) => number.partial_cmp(other),
        (Cell::Bool(checked), Value::Bool(other)) => Some(checked.cmp(other)),
        (Cell::Date(date), Value::Date(other)) => Some(date.cmp(other)),
        (Cell::Options(ids), Value::Option(id)) => single(ids).map(|only| only.cmp(id)),
        (Cell::Entities(ids), Value::Entity(id)) => {
            single(ids).map(|only| only.as_str().cmp(id.as_str()))
        }
        (Cell::Row(row), Value::Entity(id)) => id.parse::<RowId>().ok().map(|id| row.cmp(&id)),
        _ => None,
    }
}

/// The one value of a single-valued cell; an empty cell has none.
fn single<Member>(ids: &[Member]) -> Option<&Member> {
    match ids {
        [only] => Some(only),
        _ => None,
    }
}

/// SQL `LIKE` with `%` and `_`, ignoring case. The escape character makes
/// the character after it literal.
fn like(pattern: &str, escape: Option<char>, text: &str) -> bool {
    let escape = escape.map(lowercase);
    let mut parts = Vec::new();
    let lowered = pattern.to_lowercase();
    let mut characters = lowered.chars();
    while let Some(character) = characters.next() {
        parts.push(match character {
            _ if Some(character) == escape => {
                // Parse rejects a pattern that ends with its escape.
                Part::Literal(characters.next().unwrap_or(character))
            }
            '%' => Part::Any,
            '_' => Part::One,
            literal => Part::Literal(literal),
        });
    }
    let text: Vec<char> = text.to_lowercase().chars().collect();
    matches(&parts, &text)
}

/// A character's lower case when it is one character, as `to_lowercase` of the
/// whole pattern would spell it.
fn lowercase(character: char) -> char {
    let mut lower = character.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(only), None) => only,
        _ => character,
    }
}

/// One element of a `LIKE` pattern.
enum Part {
    /// `%`: any run of characters.
    Any,
    /// `_`: exactly one character.
    One,
    /// This character.
    Literal(char),
}

/// Iterative wildcard matching: on a mismatch, retry from the last `%`
/// with one more character absorbed, so the cost stays linear in the
/// pattern times the text.
fn matches(pattern: &[Part], text: &[char]) -> bool {
    let (mut pattern_at, mut text_at) = (0, 0);
    // The last `%` seen, and where the text stood when it was.
    let mut retry: Option<(usize, usize)> = None;
    while text_at < text.len() {
        match pattern.get(pattern_at) {
            Some(Part::Any) => {
                retry = Some((pattern_at, text_at));
                pattern_at += 1;
            }
            Some(Part::One) => {
                pattern_at += 1;
                text_at += 1;
            }
            Some(Part::Literal(literal)) if *literal == text[text_at] => {
                pattern_at += 1;
                text_at += 1;
            }
            _ => match retry {
                Some((any_at, absorbed_to)) => {
                    retry = Some((any_at, absorbed_to + 1));
                    pattern_at = any_at + 1;
                    text_at = absorbed_to + 1;
                }
                None => return false,
            },
        }
    }
    pattern[pattern_at..]
        .iter()
        .all(|part| matches!(part, Part::Any))
}
