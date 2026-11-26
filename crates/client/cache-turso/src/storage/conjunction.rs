//! Point-probed residual predicates for a scoped, already-selected candidate set.

use super::*;
use predicate_index::ExactValue;

#[derive(Clone, Copy)]
pub(super) enum FactSource {
    Authority,
    Optimistic,
}

#[derive(Clone, Copy)]
enum FactKind {
    Exact,
    Integer,
    Sort,
}

impl FactSource {
    fn table(self, kind: FactKind) -> (&'static str, &'static str) {
        match (self, kind) {
            (Self::Authority, FactKind::Exact) => ("exact_facts", "sqlite_autoindex_exact_facts_1"),
            (Self::Authority, FactKind::Integer) => {
                ("integer_facts", "sqlite_autoindex_integer_facts_1")
            }
            (Self::Authority, FactKind::Sort) => ("sort_facts", "sqlite_autoindex_sort_facts_1"),
            (Self::Optimistic, FactKind::Exact) => (
                "optimistic_exact_facts",
                "sqlite_autoindex_optimistic_exact_facts_1",
            ),
            (Self::Optimistic, FactKind::Integer) => (
                "optimistic_integer_facts",
                "sqlite_autoindex_optimistic_integer_facts_1",
            ),
            (Self::Optimistic, FactKind::Sort) => (
                "optimistic_sort_facts",
                "sqlite_autoindex_optimistic_sort_facts_1",
            ),
        }
    }
}

/// Keep an indexable positive conjunct as the seed. Negation must not seed an
/// unscoped universe; the remaining tests only inspect the selected documents.
pub(super) fn split(expr: &PredicateExpr) -> Option<(&PredicateExpr, Vec<&PredicateExpr>)> {
    if !matches!(expr, PredicateExpr::And(_, _)) {
        return None;
    }
    fn flatten<'a>(expr: &'a PredicateExpr, terms: &mut Vec<&'a PredicateExpr>) {
        match expr {
            PredicateExpr::And(left, right) => {
                flatten(left, terms);
                flatten(right, terms);
            }
            _ => terms.push(expr),
        }
    }
    let mut terms = Vec::new();
    flatten(expr, &mut terms);
    let index = terms.iter().position(|term| match term {
        PredicateExpr::Exact { .. }
        | PredicateExpr::ExactExists { .. }
        | PredicateExpr::I64Range { .. }
        | PredicateExpr::After { .. } => true,
        PredicateExpr::Or(_, _) => alternatives::exact_alternatives(term).is_some(),
        _ => false,
    })?;
    let seed = terms.remove(index);
    Some((seed, terms))
}

fn exists(
    source: FactSource,
    kind: FactKind,
    attribute: &Token,
    condition: &str,
    values: impl IntoIterator<Item = Value>,
    parameters: &mut Vec<Value>,
) -> String {
    parameters.push(text(attribute.as_str()));
    parameters.extend(values);
    let (table, index) = source.table(kind);
    format!(
        "EXISTS (SELECT 1 FROM {table} AS f INDEXED BY {index} WHERE f.document_id = d.id AND f.attribute = ?{condition})"
    )
}

const MAX_JOINED_FACTS: usize = 16;

/// Single exact facts tested through `LEFT JOIN`s on the fact primary key
/// instead of one `EXISTS` subprogram each. The key is (document, attribute,
/// value), so each join matches at most one row and never repeats a document.
/// A fact tested twice reuses its join. Past `MAX_JOINED_FACTS` distinct facts
/// the rest use `EXISTS`: Turso joins at most 63 tables, and every join is
/// probed for every candidate while an `EXISTS` can be skipped.
pub(super) struct ExactJoins {
    source: FactSource,
    facts: Vec<(Token, ExactValue)>,
    sql: String,
    parameters: Vec<Value>,
}

impl ExactJoins {
    pub(super) fn new(source: FactSource) -> Self {
        Self {
            source,
            facts: Vec::new(),
            sql: String::new(),
            parameters: Vec::new(),
        }
    }

    /// The joins, to follow the table that `d` names, and their parameters,
    /// which follow every parameter of the select list.
    pub(super) fn finish(self) -> (String, Vec<Value>) {
        (self.sql, self.parameters)
    }

    fn test(&mut self, attribute: &Token, value: &ExactValue) -> Option<String> {
        let index = match self
            .facts
            .iter()
            .position(|(known, known_value)| known == attribute && known_value == value)
        {
            Some(index) => index,
            None if self.facts.len() < MAX_JOINED_FACTS => {
                let index = self.facts.len();
                let (table, key) = self.source.table(FactKind::Exact);
                self.sql.push_str(&format!(
                    " LEFT JOIN {table} AS x{index} INDEXED BY {key} ON x{index}.document_id = d.id AND x{index}.attribute = ? AND x{index}.value = ?"
                ));
                self.parameters.extend([
                    text(attribute.as_str()),
                    Value::from_blob(value.as_bytes().to_vec()),
                ]);
                self.facts.push((attribute.clone(), value.clone()));
                index
            }
            None => return None,
        };
        Some(format!("x{index}.document_id IS NOT NULL"))
    }
}

pub(super) fn condition(
    expr: &PredicateExpr,
    source: FactSource,
    parameters: &mut Vec<Value>,
) -> String {
    condition_with(expr, source, parameters, &mut None)
}

/// `condition`, testing each single exact fact through `joins`.
pub(super) fn joined_condition(
    expr: &PredicateExpr,
    parameters: &mut Vec<Value>,
    joins: &mut ExactJoins,
) -> String {
    let source = joins.source;
    condition_with(expr, source, parameters, &mut Some(joins))
}

fn condition_with(
    expr: &PredicateExpr,
    source: FactSource,
    parameters: &mut Vec<Value>,
    joins: &mut Option<&mut ExactJoins>,
) -> String {
    if matches!(expr, PredicateExpr::Or(_, _))
        && let Some((attribute, values)) = alternatives::exact_alternatives(expr)
    {
        return exists(
            source,
            FactKind::Exact,
            attribute,
            &format!(" AND f.value IN ({})", vec!["?"; values.len()].join(", ")),
            values
                .iter()
                .map(|value| Value::from_blob(value.as_bytes().to_vec())),
            parameters,
        );
    }
    match expr {
        PredicateExpr::All => "1".into(),
        PredicateExpr::None => "0".into(),
        PredicateExpr::Exact { attribute, value } => match joins
            .as_mut()
            .and_then(|joins| joins.test(attribute, value))
        {
            Some(test) => test,
            None => exists(
                source,
                FactKind::Exact,
                attribute,
                " AND f.value = ?",
                [Value::from_blob(value.as_bytes().to_vec())],
                parameters,
            ),
        },
        PredicateExpr::ExactExists { attribute } => {
            exists(source, FactKind::Exact, attribute, "", [], parameters)
        }
        PredicateExpr::I64Range {
            attribute,
            lower,
            upper,
        } => {
            let mut range = String::new();
            let mut values = Vec::new();
            for (bound, lower) in [(lower, true), (upper, false)] {
                if let Some(bound) = bound {
                    let (operator, value) = sql_bound(*bound, lower);
                    range.push_str(&format!(" AND f.value {operator} ?"));
                    values.push(Value::from_i64(value));
                }
            }
            exists(
                source,
                FactKind::Integer,
                attribute,
                &range,
                values,
                parameters,
            )
        }
        PredicateExpr::After {
            attribute,
            value,
            key,
            direction,
            tie_direction,
        } => {
            let order = if *direction == SortDirection::Asc {
                ">"
            } else {
                "<"
            };
            let tie = if *tie_direction == SortDirection::Asc {
                ">"
            } else {
                "<"
            };
            exists(
                source,
                FactKind::Sort,
                attribute,
                &format!(" AND (f.value {order} ? OR (f.value = ? AND d.record_key {tie} ?))"),
                [
                    Value::from_i64(*value),
                    Value::from_i64(*value),
                    text(key.as_str()),
                ],
                parameters,
            )
        }
        PredicateExpr::And(left, right) => format!(
            "({} AND {})",
            condition_with(left, source, parameters, joins),
            condition_with(right, source, parameters, joins)
        ),
        PredicateExpr::Or(left, right) => format!(
            "({} OR {})",
            condition_with(left, source, parameters, joins),
            condition_with(right, source, parameters, joins)
        ),
        PredicateExpr::Not(inner) => {
            format!("NOT ({})", condition_with(inner, source, parameters, joins))
        }
    }
}
