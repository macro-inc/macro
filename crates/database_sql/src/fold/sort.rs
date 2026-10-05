//! Ordering rows and groups. Empty cells sort last in either direction;
//! select values sort in the column's option order; entities by id.

use std::cmp::Ordering;
use std::collections::HashMap;

use models_databases::OptionId;
use uuid::Uuid;

use crate::catalog::{Catalog, ColumnKind};
use crate::resolve::{Direction, OrderKey, SelectItem};
use crate::split::Plan;

use super::aggregate::Group;
use super::{Cell, Row, group_order_index};

/// Each option's place in its column's declared order.
type OptionRanks = HashMap<OptionId, usize>;

/// Sort fetched rows by column keys. A key on an item index cannot occur
/// here: a row shape has no aggregates to refer to.
pub fn rows(catalog: &Catalog, plan: &Plan, rows: &mut [Row]) {
    let keys: Vec<(Uuid, Direction, OptionRanks)> = plan
        .order_by
        .iter()
        .map(|order| {
            let OrderKey::Column(column) = order.key else {
                unreachable!("row shapes order by columns only");
            };
            (column, order.direction, option_ranks(catalog, plan, column))
        })
        .collect();
    rows.sort_by(|left, right| {
        keys.iter()
            .map(|(column, direction, ranks)| {
                directed(
                    compare(ranks, left.cells.get(column), right.cells.get(column)),
                    *direction,
                )
            })
            .find(|ordering| *ordering != Ordering::Equal)
            .unwrap_or(Ordering::Equal)
    });
}

/// Sort groups by select-list position.
pub fn groups(
    catalog: &Catalog,
    plan: &Plan,
    groups: &mut [Group],
    group_by: Option<Uuid>,
    items: &[SelectItem],
) {
    let keys: Vec<(Option<usize>, Direction, OptionRanks)> = plan
        .order_by
        .iter()
        .map(|order| {
            let index = group_order_index(&order.key, group_by, items);
            let column = match index.map(|index| &items[index]) {
                Some(SelectItem::Column(key))
                | Some(SelectItem::Aggregate {
                    column: Some(key), ..
                }) => Some(*key),
                Some(SelectItem::Aggregate { column: None, .. }) => None,
                // ORDER BY the group column when it is not selected.
                None => group_by,
            };
            let ranks = column
                .map(|column| option_ranks(catalog, plan, column))
                .unwrap_or_default();
            (index, order.direction, ranks)
        })
        .collect();
    groups.sort_by(|left, right| {
        keys.iter()
            .map(|(index, direction, ranks)| {
                let ordering = match index {
                    Some(index) => compare(
                        ranks,
                        left.cells[*index].as_ref(),
                        right.cells[*index].as_ref(),
                    ),
                    None => compare(ranks, left.key.as_ref(), right.key.as_ref()),
                };
                directed(ordering, *direction)
            })
            .find(|ordering| *ordering != Ordering::Equal)
            .unwrap_or(Ordering::Equal)
    });
}

/// The option order of the select column behind `key`; empty for any other
/// column.
fn option_ranks(catalog: &Catalog, plan: &Plan, key: Uuid) -> OptionRanks {
    match plan.column(catalog, key).map(|column| &column.kind) {
        Some(ColumnKind::Select { options, .. }) => options
            .iter()
            .enumerate()
            .map(|(rank, option)| (option.id, rank))
            .collect(),
        _ => OptionRanks::new(),
    }
}

/// Reverse for `DESC`, but keep empty cells last.
fn directed(ordering: Ranked, direction: Direction) -> Ordering {
    match (ordering, direction) {
        (Ranked::Both(ordering), Direction::Ascending) => ordering,
        (Ranked::Both(ordering), Direction::Descending) => ordering.reverse(),
        (Ranked::EmptyLeft, _) => Ordering::Greater,
        (Ranked::EmptyRight, _) => Ordering::Less,
        (Ranked::BothEmpty, _) => Ordering::Equal,
    }
}

/// A comparison that remembers which side was empty.
enum Ranked {
    Both(Ordering),
    EmptyLeft,
    EmptyRight,
    BothEmpty,
}

fn compare(ranks: &OptionRanks, left: Option<&Cell>, right: Option<&Cell>) -> Ranked {
    match (
        left.filter(|cell| !cell.is_empty()),
        right.filter(|cell| !cell.is_empty()),
    ) {
        (None, None) => Ranked::BothEmpty,
        (None, Some(_)) => Ranked::EmptyLeft,
        (Some(_), None) => Ranked::EmptyRight,
        (Some(left), Some(right)) => Ranked::Both(match (left, right) {
            (Cell::Text(left), Cell::Text(right)) => left.to_lowercase().cmp(&right.to_lowercase()),
            (Cell::Number(left), Cell::Number(right)) => {
                left.partial_cmp(right).unwrap_or(Ordering::Equal)
            }
            (Cell::Bool(left), Cell::Bool(right)) => left.cmp(right),
            (Cell::Date(left), Cell::Date(right)) => left.cmp(right),
            (Cell::Options(left), Cell::Options(right)) => {
                option_rank(ranks, left).cmp(&option_rank(ranks, right))
            }
            (Cell::Entities(left), Cell::Entities(right)) => left.cmp(right),
            (Cell::Row(left), Cell::Row(right)) => left.cmp(right),
            _ => Ordering::Equal,
        }),
    }
}

/// The rank of a cell is the rank of each option it holds, in order; an
/// option the column no longer declares sorts after every declared one.
fn option_rank(ranks: &OptionRanks, options: &[OptionId]) -> Vec<usize> {
    options
        .iter()
        .map(|option| ranks.get(option).copied().unwrap_or(usize::MAX))
        .collect()
}
