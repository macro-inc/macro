//! Point-probed residual predicates for a scoped, already-selected candidate set.

use super::*;

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

pub(super) fn condition(
    expr: &PredicateExpr,
    source: FactSource,
    parameters: &mut Vec<Value>,
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
        PredicateExpr::Exact { attribute, value } => exists(
            source,
            FactKind::Exact,
            attribute,
            " AND f.value = ?",
            [Value::from_blob(value.as_bytes().to_vec())],
            parameters,
        ),
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
            condition(left, source, parameters),
            condition(right, source, parameters)
        ),
        PredicateExpr::Or(left, right) => format!(
            "({} OR {})",
            condition(left, source, parameters),
            condition(right, source, parameters)
        ),
        PredicateExpr::Not(inner) => format!("NOT ({})", condition(inner, source, parameters)),
    }
}
