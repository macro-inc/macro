//! Which parts of a `WHERE` the Soup `propf` expression can express.
//!
//! Soup matches a select option or an entity reference on a property, and
//! combines matches with and/or. It also has `not`, but Soup's `not` is a set
//! difference from every row, so it keeps rows whose cell is empty, while
//! SQL's `!=` drops them. Negated forms therefore never push down.
//!
//! A top-level `AND` pushes its pushable conjuncts and keeps the rest; an
//! `OR` pushes only when every side does, because a half-pushed `OR` would
//! drop rows the other side wanted. A conjunct pushes only when every column
//! it tests belongs to one relation, since each relation is fetched on its
//! own; the row id is not a property, so it never pushes. Nothing pushes
//! into `people`, whose query takes no filter.
//!
//! Nothing pushes into a left-joined relation either: filtering its read
//! narrows what the join matches, so a row with no match would survive with
//! `NULL`s where `WHERE` should drop it. Its conditions stay residual and
//! apply after the join.

use filter_ast::Expr;
use item_filters::ast::properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue};

use crate::catalog::TableSource;
use crate::resolve::{
    Binding, ComparisonOperator, Filter, JoinKind, Relation, ResolvedJoin, Value, binding,
};

/// The expression pushed into each relation's query, indexed by relation,
/// and the filter that remains.
pub fn divide(
    filter: Filter,
    bindings: &[Binding],
    relations: &[Relation],
    joins: &[ResolvedJoin],
) -> (Vec<Option<Expr<PropertiesLiteral>>>, Option<Filter>) {
    let left_joined: Vec<usize> = joins
        .iter()
        .filter(|join| join.kind == JoinKind::Left)
        .map(|join| join.relation)
        .collect();
    let pushable = |filter: &Filter| {
        pushable(filter, bindings, relations)
            .filter(|(relation, _)| !left_joined.contains(relation))
    };
    let mut pushed: Vec<Option<Expr<PropertiesLiteral>>> = vec![None; relations.len()];
    let mut push_into = |relation: usize, expr: Expr<PropertiesLiteral>| {
        pushed[relation] = Some(match pushed[relation].take() {
            Some(existing) => Expr::and(existing, expr),
            None => expr,
        });
    };
    let residual = match filter {
        Filter::And(parts) => {
            let mut kept = Vec::new();
            for part in parts {
                match pushable(&part) {
                    Some((relation, expr)) => push_into(relation, expr),
                    None => kept.push(part),
                }
            }
            match kept.len() {
                0 => None,
                1 => kept.pop(),
                _ => Some(Filter::And(kept)),
            }
        }
        other => match pushable(&other) {
            Some((relation, expr)) => {
                push_into(relation, expr);
                None
            }
            None => Some(other),
        },
    };
    (pushed, residual)
}

/// The relation a whole filter tests and its `propf` form, or `None` if it
/// spans relations, tests `people`, or any part of it cannot be expressed.
fn pushable(
    filter: &Filter,
    bindings: &[Binding],
    relations: &[Relation],
) -> Option<(usize, Expr<PropertiesLiteral>)> {
    let mut relation = None;
    let mut spans = false;
    filter.for_each_column(&mut |key| {
        let owner = binding(bindings, key).map(|binding| binding.relation);
        match (relation, owner) {
            (None, Some(owner)) => relation = Some(owner),
            (Some(current), Some(owner)) if current == owner => {}
            _ => spans = true,
        }
    });
    let relation = relation?;
    if spans || relations[relation].source != TableSource::Database {
        return None;
    }
    Some((relation, push(filter, bindings)?))
}

/// The whole filter as a `propf` expression, or `None` if any part of it
/// cannot be expressed.
fn push(filter: &Filter, bindings: &[Binding]) -> Option<Expr<PropertiesLiteral>> {
    match filter {
        Filter::Comparison {
            column,
            operator: ComparisonOperator::Equal,
            value,
        } => literal(*column, value, bindings),
        Filter::In {
            column,
            values,
            negated: false,
        } => values
            .iter()
            .map(|value| literal(*column, value, bindings))
            .collect::<Option<Vec<_>>>()?
            .into_iter()
            .reduce(Expr::or),
        Filter::Has {
            column,
            value,
            negated: false,
        } => literal(*column, value, bindings),
        Filter::And(parts) => parts
            .iter()
            .map(|part| push(part, bindings))
            .collect::<Option<Vec<_>>>()?
            .into_iter()
            .reduce(Expr::and),
        Filter::Or(parts) => parts
            .iter()
            .map(|part| push(part, bindings))
            .collect::<Option<Vec<_>>>()?
            .into_iter()
            .reduce(Expr::or),
        _ => None,
    }
}

/// A match on one option or one entity reference of the property behind a
/// key.
fn literal(
    key: uuid::Uuid,
    value: &Value,
    bindings: &[Binding],
) -> Option<Expr<PropertiesLiteral>> {
    let definition = binding(bindings, key)?.column?;
    let value = match value {
        Value::Option(option) => PropertyMatchValue::SelectOption(option.into_uuid()),
        // Resolve accepted the id; the ref type rejects only quotes and
        // backslashes, which no id contains.
        Value::Entity(id) => PropertyMatchValue::EntityRef(EntityRefId::new(id.clone()).ok()?),
        _ => return None,
    };
    Some(Expr::Literal(PropertiesLiteral {
        property_definition_id: definition,
        entity_type: None,
        value,
    }))
}
