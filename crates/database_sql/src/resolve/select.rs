//! `SELECT`: the tables and joins into a scope, the select list against
//! `GROUP BY`, aggregates against column kinds, `ORDER BY` against the
//! select list.

use uuid::Uuid;

use crate::catalog::{Catalog, ColumnKind};
use crate::parse::{
    Aggregate, AggregateFunction, ColumnRef, Identifier, Item, Join, OrderBy,
    OrderKey as ParsedOrderKey, Select, SelectList,
};

use super::names::{Bound, Scope};
use super::{
    Order, OrderKey, Relation, ResolveError, ResolvedJoin, SelectItem, SelectQuery, filter,
};

pub fn resolve(catalog: &Catalog, select: Select) -> Result<SelectQuery, ResolveError> {
    let mut scope = Scope::new(catalog, &select.from)?;
    let joins = select
        .joins
        .iter()
        .map(|join| resolve_join(catalog, &mut scope, join))
        .collect::<Result<Vec<_>, _>>()?;

    let group_by = select
        .group_by
        .as_ref()
        .map(|name| scope.column(name))
        .transpose()?;

    // Each item with the column it selects, for the grouping check's message.
    let resolved: Vec<(SelectItem, Option<Bound>)> = match &select.items {
        SelectList::Star => {
            let mut resolved = Vec::new();
            for index in 0..scope.relations.len() {
                for column in &scope.relations[index].table.columns {
                    let reference = ColumnRef {
                        table: Some(Identifier(scope.relations[index].alias.clone())),
                        column: Identifier(column.name.clone()),
                    };
                    let bound = scope.column(&reference)?;
                    resolved.push((SelectItem::Column(bound.key), Some(bound)));
                }
            }
            resolved
        }
        SelectList::Items(written) => written
            .iter()
            .map(|item| resolve_item(&mut scope, item))
            .collect::<Result<_, _>>()?,
    };

    let aggregates = resolved
        .iter()
        .any(|(item, _)| matches!(item, SelectItem::Aggregate { .. }));
    if aggregates || group_by.is_some() {
        for (_, bound) in &resolved {
            if let Some(bound) = bound
                && group_by.as_ref().map(|group| group.key) != Some(bound.key)
            {
                return Err(ResolveError::ColumnNotGrouped {
                    column: bound.column.name.clone(),
                    grouped: group_by.is_some(),
                });
            }
        }
    }
    let items: Vec<SelectItem> = resolved.into_iter().map(|(item, _)| item).collect();

    let where_ = select
        .where_
        .map(|condition| filter::resolve(&mut scope, condition))
        .transpose()?;

    let labels: Vec<(usize, String)> = select
        .aliases
        .iter()
        .map(|(index, alias)| (*index, alias.0.clone()))
        .collect();
    let order_by = select
        .order_by
        .iter()
        .map(|order| {
            resolve_order(
                &mut scope,
                &items,
                &labels,
                group_by.as_ref().map(|bound| bound.key),
                order,
            )
        })
        .collect::<Result<_, _>>()?;

    Ok(SelectQuery {
        distinct: select.distinct,
        relations: scope
            .relations
            .iter()
            .map(|relation| Relation {
                table: relation.table.id,
                alias: relation.alias.clone(),
                source: relation.table.source,
            })
            .collect(),
        joins,
        items,
        labels,
        where_,
        group_by: group_by.map(|bound| bound.key),
        order_by,
        limit: select.limit,
        offset: select.offset,
        bindings: scope.bindings,
    })
}

/// Bring the joined table into scope and check each `ON` equality: one
/// side in the new relation, the other in an earlier one, of matching kinds.
fn resolve_join<'c>(
    catalog: &'c Catalog,
    scope: &mut Scope<'c>,
    join: &Join,
) -> Result<ResolvedJoin, ResolveError> {
    let relation = scope.add(catalog, &join.table)?;
    let alias = scope.relations[relation].alias.clone();
    let on = join
        .on
        .iter()
        .map(|(left, right)| {
            let left = scope.column(left)?;
            let right = scope.column(right)?;
            let (earlier, joined) = match (left.relation == relation, right.relation == relation) {
                (false, true) if left.relation < relation => (left, right),
                (true, false) if right.relation < relation => (right, left),
                _ => {
                    return Err(ResolveError::JoinNotAcrossTables {
                        alias: alias.clone(),
                        left: scope.describe(&left),
                        right: scope.describe(&right),
                    });
                }
            };
            if !joinable(&earlier, &joined) {
                return Err(ResolveError::JoinKindMismatch {
                    left: scope.describe(&earlier),
                    left_kind: earlier.column.kind.describe(),
                    right: scope.describe(&joined),
                    right_kind: joined.column.kind.describe(),
                });
            }
            Ok((earlier.key, joined.key))
        })
        .collect::<Result<_, _>>()?;
    Ok(ResolvedJoin {
        relation,
        kind: join.kind,
        on,
    })
}

/// Entity references match row ids and each other; anything else matches
/// only its own kind. Whether a side holds several values does not matter:
/// a multi-valued side matches by membership.
fn joinable(earlier: &Bound, joined: &Bound) -> bool {
    match (&earlier.column.kind, &joined.column.kind) {
        (ColumnKind::Entity { .. }, ColumnKind::Entity { .. }) => true,
        (ColumnKind::Select { .. }, ColumnKind::Select { .. }) => true,
        (earlier, joined) => earlier == joined,
    }
}

fn resolve_item(
    scope: &mut Scope<'_>,
    item: &Item,
) -> Result<(SelectItem, Option<Bound>), ResolveError> {
    match item {
        Item::Column(name) => {
            let bound = scope.column(name)?;
            Ok((SelectItem::Column(bound.key), Some(bound)))
        }
        Item::Aggregate(aggregate) => Ok((resolve_aggregate(scope, aggregate)?, None)),
    }
}

fn resolve_aggregate(
    scope: &mut Scope<'_>,
    aggregate: &Aggregate,
) -> Result<SelectItem, ResolveError> {
    let Some(name) = &aggregate.argument else {
        return Ok(SelectItem::Aggregate {
            function: aggregate.function,
            column: None,
        });
    };
    let bound = scope.column(name)?;
    let allowed = match aggregate.function {
        AggregateFunction::Count => true,
        AggregateFunction::Sum | AggregateFunction::Avg => bound.column.kind == ColumnKind::Number,
        AggregateFunction::Min | AggregateFunction::Max => {
            matches!(bound.column.kind, ColumnKind::Number | ColumnKind::Date)
        }
    };
    if !allowed {
        return Err(ResolveError::AggregateNotSupported {
            func: aggregate.function.name(),
            column: bound.column.name.clone(),
            kind: bound.column.kind.describe(),
        });
    }
    Ok(SelectItem::Aggregate {
        function: aggregate.function,
        column: Some(bound.key),
    })
}

fn resolve_order(
    scope: &mut Scope<'_>,
    items: &[SelectItem],
    labels: &[(usize, String)],
    group_by: Option<Uuid>,
    order: &OrderBy,
) -> Result<Order, ResolveError> {
    let key = match &order.key {
        ParsedOrderKey::Position(position) => {
            let index = *position as usize - 1;
            if index >= items.len() {
                return Err(ResolveError::OrderPositionOutOfRange {
                    position: *position,
                    items: items.len(),
                });
            }
            OrderKey::Item(index)
        }
        ParsedOrderKey::Aggregate(aggregate) => {
            let wanted = resolve_aggregate(scope, aggregate)?;
            items
                .iter()
                .position(|item| *item == wanted)
                .map(OrderKey::Item)
                .ok_or_else(|| ResolveError::OrderAggregateNotSelected {
                    agg: aggregate.to_string(),
                })?
        }
        ParsedOrderKey::Column(name) => match labeled(labels, name) {
            Some(index) => OrderKey::Item(index),
            None => order_column(scope, items, group_by, name)?,
        },
    };
    Ok(Order {
        key,
        direction: order.direction,
    })
}

/// The select-list position an unqualified name labels with `AS`.
fn labeled(labels: &[(usize, String)], name: &ColumnRef) -> Option<usize> {
    if name.table.is_some() {
        return None;
    }
    labels
        .iter()
        .find(|(_, label)| label.eq_ignore_ascii_case(&name.column.0))
        .map(|(index, _)| *index)
}

/// `ORDER BY column`, which a grouped query allows only on its group column.
fn order_column(
    scope: &mut Scope<'_>,
    items: &[SelectItem],
    group_by: Option<Uuid>,
    name: &ColumnRef,
) -> Result<OrderKey, ResolveError> {
    let bound = scope.column(name)?;
    let grouped = group_by.is_some()
        || items
            .iter()
            .any(|item| matches!(item, SelectItem::Aggregate { .. }));
    if grouped && group_by != Some(bound.key) {
        return Err(ResolveError::OrderColumnNotGrouped {
            column: bound.column.name.clone(),
        });
    }
    Ok(OrderKey::Column(bound.key))
}
