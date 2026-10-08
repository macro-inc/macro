//! Derived columns: a [`Formula`]'s text form, its type, and its value on a
//! row.
//!
//! ```text
//! formula := term {('+' | '-') term}
//! term    := unary {('*' | '/') unary}
//! unary   := '-' unary | atom
//! atom    := number | '{' name '}' | word | '(' formula ')'
//! ```
//!
//! A `word` is a column name of letters, digits and `_`; any other name is
//! written in braces, `{Unit price}`. Names match ignoring case.
//!
//! Numbers combine with `+ - * /`. A number added to or subtracted from a
//! date counts days, and one date minus another is the days between them.
//! An empty number reads as `0`, so a new row's total does not vanish
//! because one input is blank, but a formula whose every column is empty is
//! empty, and so is anything involving an empty date or dividing by zero.

mod parser;
#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::ops::Range;

use chrono::{DateTime, Duration, Utc};
use models_databases::{ColumnId, Formula, FormulaType, Operator};
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::catalog::{Column, ColumnKind, Table};
use crate::fold::Cell;
use crate::parse::ParseError;

/// How deep derived columns may nest within one another before a formula is
/// refused, as a guard against a cycle that slipped into stored data.
const MAX_DEPTH: usize = 32;

/// What a formula typed into a derived column's editor reads as.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FormulaReading {
    /// It parses and its types fit.
    Valid {
        /// The formula, columns by id.
        formula: Formula,
        /// What its cells hold.
        result: FormulaType,
    },
    /// It does not, and why.
    Invalid {
        /// What is wrong, in words for the person typing.
        message: String,
        /// The part of the text it is about, in UTF-16 code units as a
        /// browser counts them, when it is about a part.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = Option<crate::parse::Span>)]
        span: Option<Range<usize>>,
    },
}

/// Parse and check `text` as the formula of a derived column of `table`:
/// `own`, when it exists already.
pub fn read(table: &Table, own: Option<ColumnId>, text: &str) -> FormulaReading {
    let formula = match parse(table, text) {
        Ok(formula) => formula,
        Err(error) => {
            let utf16 = |byte: usize| text[..byte].encode_utf16().count();
            return FormulaReading::Invalid {
                message: error.message,
                span: Some(utf16(error.span.start)..utf16(error.span.end)),
            };
        }
    };
    match check(table, own, &formula) {
        Ok(result) => FormulaReading::Valid { formula, result },
        Err(message) => FormulaReading::Invalid {
            message,
            span: None,
        },
    }
}

/// A formula typed for `table`, its column names resolved to ids.
pub fn parse(table: &Table, text: &str) -> Result<Formula, ParseError> {
    parser::formula(table, text)
}

/// The formula as users write it, with `table`'s current column names; a
/// column the table no longer has reads `{?}`.
pub fn render(table: &Table, formula: &Formula) -> String {
    render_named(formula, &|column| {
        placement(table, column).map(|found| found.name.as_str())
    })
}

/// The formula as users write it, each column under the name `name` gives
/// it.
pub fn render_named<'name>(
    formula: &Formula,
    name: &impl Fn(ColumnId) -> Option<&'name str>,
) -> String {
    render_at(formula, name, Precedence::Sum)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Precedence {
    Sum,
    Product,
    Unary,
}

fn precedence(operator: Operator) -> Precedence {
    match operator {
        Operator::Add | Operator::Subtract => Precedence::Sum,
        Operator::Multiply | Operator::Divide => Precedence::Product,
    }
}

fn render_at<'name>(
    formula: &Formula,
    name: &impl Fn(ColumnId) -> Option<&'name str>,
    outer: Precedence,
) -> String {
    match formula {
        Formula::Column { column } => match name(*column) {
            Some(name) if is_word(name) => name.to_owned(),
            Some(name) => format!("{{{name}}}"),
            None => "{?}".into(),
        },
        Formula::Number { value } => value.to_string(),
        Formula::Binary {
            operator,
            left,
            right,
        } => {
            let own = precedence(*operator);
            // Left-associative: an equal-precedence right operand keeps its
            // parentheses, `a - (b - c)`.
            let right_floor = match own {
                Precedence::Sum => Precedence::Product,
                _ => Precedence::Unary,
            };
            let text = format!(
                "{} {} {}",
                render_at(left, name, own),
                operator.symbol(),
                render_at(right, name, right_floor)
            );
            if own < outer {
                format!("({text})")
            } else {
                text
            }
        }
        Formula::Negate { operand } => {
            format!("-{}", render_at(operand, name, Precedence::Unary))
        }
    }
}

/// Whether a name can be written without braces.
fn is_word(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_alphabetic() || first == '_')
        && characters.all(|character| character.is_alphanumeric() || character == '_')
}

/// What the formula's cells hold, if its columns and operators fit. `own`
/// is the derived column the formula is for, when it exists already, so a
/// formula reading it, directly or through another derived column, is
/// refused as a cycle.
pub fn check(
    table: &Table,
    own: Option<ColumnId>,
    formula: &Formula,
) -> Result<FormulaType, String> {
    let mut path: Vec<ColumnId> = own.into_iter().collect();
    check_in(table, formula, &mut path).map_err(|error| match error {
        CheckError::Cycle(name) => {
            format!("{name} can't be used here: its value depends on this column.")
        }
        CheckError::Other(message) => message,
    })
}

/// Why a formula does not check. A cycle names the column the formula
/// itself reads, however deep the loop closes.
enum CheckError {
    Cycle(String),
    Other(String),
}

fn check_in(
    table: &Table,
    formula: &Formula,
    path: &mut Vec<ColumnId>,
) -> Result<FormulaType, CheckError> {
    match formula {
        Formula::Column { column } => {
            let found = placement(table, *column).ok_or_else(|| {
                CheckError::Other("The formula names a column this table no longer has.".into())
            })?;
            if path.contains(column) {
                return Err(CheckError::Cycle(found.name.clone()));
            }
            match &found.formula {
                Some(inner) => {
                    if path.len() >= MAX_DEPTH {
                        return Err(CheckError::Other("Formulas nest too deeply.".into()));
                    }
                    path.push(*column);
                    let result = check_in(table, inner, path);
                    path.pop();
                    result.map_err(|error| match error {
                        CheckError::Cycle(_) => CheckError::Cycle(found.name.clone()),
                        other => other,
                    })
                }
                None => match found.kind {
                    ColumnKind::Number => Ok(FormulaType::Number),
                    ColumnKind::Date => Ok(FormulaType::Date),
                    ref other => Err(CheckError::Other(format!(
                        "{} is {} {} column; formulas use number and date columns.",
                        found.name,
                        article(other.describe()),
                        other.describe()
                    ))),
                },
            }
        }
        Formula::Number { value } if value.is_finite() => Ok(FormulaType::Number),
        Formula::Number { .. } => Err(CheckError::Other(
            "Numbers in a formula must be finite.".into(),
        )),
        Formula::Negate { operand } => match check_in(table, operand, path)? {
            FormulaType::Number => Ok(FormulaType::Number),
            FormulaType::Date => Err(CheckError::Other("A date can't be negated.".into())),
        },
        Formula::Binary {
            operator,
            left,
            right,
        } => {
            let left = check_in(table, left, path)?;
            let right = check_in(table, right, path)?;
            combine(*operator, left, right).ok_or_else(|| {
                let (left, right) = (describe(left), describe(right));
                CheckError::Other(match operator {
                    Operator::Add => format!("A {right} can't be added to a {left}."),
                    Operator::Subtract => {
                        format!("A {right} can't be subtracted from a {left}.")
                    }
                    Operator::Multiply => format!("A {left} can't be multiplied by a {right}."),
                    Operator::Divide => format!("A {left} can't be divided by a {right}."),
                })
            })
        }
    }
}

fn article(word: &str) -> &'static str {
    match word.chars().next() {
        Some('a' | 'e' | 'i' | 'o' | 'u') => "an",
        _ => "a",
    }
}

fn describe(kind: FormulaType) -> &'static str {
    match kind {
        FormulaType::Number => "number",
        FormulaType::Date => "date",
    }
}

/// The type of `left operator right`, if the operator takes those types.
fn combine(operator: Operator, left: FormulaType, right: FormulaType) -> Option<FormulaType> {
    use FormulaType::{Date, Number};
    match (operator, left, right) {
        (_, Number, Number) => Some(Number),
        (Operator::Add, Date, Number) | (Operator::Add, Number, Date) => Some(Date),
        (Operator::Subtract, Date, Number) => Some(Date),
        (Operator::Subtract, Date, Date) => Some(Number),
        _ => None,
    }
}

fn placement(table: &Table, column: ColumnId) -> Option<&Column> {
    table
        .columns
        .iter()
        .find(|candidate| candidate.placement == column)
}

/// The formula's value on a row whose cells `cells` holds, each column's
/// under `key(definition)`. `None` is an empty cell.
pub fn evaluate(
    table: &Table,
    formula: &Formula,
    cells: &HashMap<Uuid, Cell>,
    key: impl Fn(Uuid) -> Uuid + Copy,
) -> Option<Cell> {
    let row = Row { table, cells, key };
    if !row.any_present(formula, 0) {
        return None;
    }
    match row.value(formula, 0)? {
        Value::Number(number) if number.is_finite() => Some(Cell::Number(number)),
        Value::Number(_) => None,
        Value::Date(date) => Some(Cell::Date(date)),
    }
}

/// A value mid-evaluation.
#[derive(Debug, Clone, Copy)]
enum Value {
    Number(f64),
    Date(DateTime<Utc>),
}

struct Row<'a, Key> {
    table: &'a Table,
    cells: &'a HashMap<Uuid, Cell>,
    key: Key,
}

impl<Key: Fn(Uuid) -> Uuid + Copy> Row<'_, Key> {
    /// Whether any column the formula reads, through derived columns too,
    /// has a value on this row.
    fn any_present(&self, formula: &Formula, depth: usize) -> bool {
        if depth > MAX_DEPTH {
            return false;
        }
        formula.columns().into_iter().any(|column| {
            let Some(found) = placement(self.table, column) else {
                return false;
            };
            match &found.formula {
                Some(inner) => self.any_present(inner, depth + 1),
                None => self.cells.contains_key(&(self.key)(found.id)),
            }
        })
    }

    fn value(&self, formula: &Formula, depth: usize) -> Option<Value> {
        if depth > MAX_DEPTH {
            return None;
        }
        match formula {
            Formula::Number { value } => Some(Value::Number(*value)),
            Formula::Column { column } => {
                let found = placement(self.table, *column)?;
                match (&found.formula, &found.kind) {
                    (Some(inner), _) => self.value(inner, depth + 1),
                    (None, ColumnKind::Number) => match self.cells.get(&(self.key)(found.id)) {
                        Some(Cell::Number(number)) => Some(Value::Number(*number)),
                        None => Some(Value::Number(0.0)),
                        Some(_) => None,
                    },
                    (None, ColumnKind::Date) => match self.cells.get(&(self.key)(found.id)) {
                        Some(Cell::Date(date)) => Some(Value::Date(*date)),
                        _ => None,
                    },
                    (None, _) => None,
                }
            }
            Formula::Negate { operand } => match self.value(operand, depth)? {
                Value::Number(number) => Some(Value::Number(-number)),
                Value::Date(_) => None,
            },
            Formula::Binary {
                operator,
                left,
                right,
            } => apply(
                *operator,
                self.value(left, depth)?,
                self.value(right, depth)?,
            ),
        }
    }
}

fn apply(operator: Operator, left: Value, right: Value) -> Option<Value> {
    match (operator, left, right) {
        (Operator::Add, Value::Number(left), Value::Number(right)) => {
            Some(Value::Number(left + right))
        }
        (Operator::Subtract, Value::Number(left), Value::Number(right)) => {
            Some(Value::Number(left - right))
        }
        (Operator::Multiply, Value::Number(left), Value::Number(right)) => {
            Some(Value::Number(left * right))
        }
        (Operator::Divide, Value::Number(left), Value::Number(right)) => {
            Some(Value::Number(left / right))
        }
        (Operator::Add, Value::Date(date), Value::Number(days))
        | (Operator::Add, Value::Number(days), Value::Date(date)) => {
            shift(date, days).map(Value::Date)
        }
        (Operator::Subtract, Value::Date(date), Value::Number(days)) => {
            shift(date, -days).map(Value::Date)
        }
        (Operator::Subtract, Value::Date(left), Value::Date(right)) => Some(Value::Number(
            (left - right).num_milliseconds() as f64 / MILLISECONDS_PER_DAY,
        )),
        _ => None,
    }
}

const MILLISECONDS_PER_DAY: f64 = 86_400_000.0;

/// `date` moved by `days`, which may be fractional; `None` past the range
/// a date can hold.
fn shift(date: DateTime<Utc>, days: f64) -> Option<DateTime<Utc>> {
    let milliseconds = days * MILLISECONDS_PER_DAY;
    if !milliseconds.is_finite() || milliseconds.abs() > i64::MAX as f64 {
        return None;
    }
    date.checked_add_signed(Duration::milliseconds(milliseconds.round() as i64))
}

/// The derived columns of `table`, each with its formula.
pub fn derived(table: &Table) -> impl Iterator<Item = (&Column, &Formula)> {
    table
        .columns
        .iter()
        .filter_map(|column| column.formula.as_ref().map(|formula| (column, formula)))
}
