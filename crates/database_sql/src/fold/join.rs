//! Hash joins over fetched relations.
//!
//! Each join indexes the joined relation's rows by the values of its `on`
//! columns, then walks the rows built so far and pairs each with every
//! indexed row carrying the same values. A multi-valued cell is indexed (or
//! looked up) once per member, so a task assigned to two people pairs with
//! both; an empty cell matches nothing, as SQL's `NULL` does. A `LEFT` join
//! keeps a row with no match, without the joined relation's cells.

use std::collections::HashMap;

use models_databases::OptionId;
use uuid::Uuid;

use crate::resolve::JoinKind;
use crate::split::Plan;

use super::{Cell, Row};

/// Join the fetched relations in plan order; with one relation, its rows.
pub fn join(plan: &Plan, fetched: Vec<Vec<Row>>) -> Vec<Row> {
    let mut fetched = fetched.into_iter();
    let mut rows = fetched.next().unwrap_or_default();
    for (join, right) in plan.joins.iter().zip(fetched) {
        let right_keys: Vec<Uuid> = join.on.iter().map(|(_, right)| *right).collect();
        let left_keys: Vec<Uuid> = join.on.iter().map(|(left, _)| *left).collect();

        let mut index: HashMap<Vec<String>, Vec<usize>> = HashMap::new();
        for (position, row) in right.iter().enumerate() {
            for key in composite_keys(row, &right_keys) {
                index.entry(key).or_default().push(position);
            }
        }

        rows = rows
            .into_iter()
            .flat_map(|left| {
                let mut matched: Vec<usize> = composite_keys(&left, &left_keys)
                    .into_iter()
                    .flat_map(|key| index.get(&key).cloned().unwrap_or_default())
                    .collect();
                matched.sort_unstable();
                matched.dedup();
                if matched.is_empty() {
                    return match join.kind {
                        JoinKind::Inner => Vec::new(),
                        JoinKind::Left => vec![left],
                    };
                }
                matched
                    .into_iter()
                    .map(|position| {
                        let mut merged = left.clone();
                        merged.cells.extend(
                            right[position]
                                .cells
                                .iter()
                                .map(|(key, cell)| (*key, cell.clone())),
                        );
                        merged
                    })
                    .collect()
            })
            .collect();
    }
    rows
}

/// Every combination of one member per join column; none if any column is
/// empty.
fn composite_keys(row: &Row, columns: &[Uuid]) -> Vec<Vec<String>> {
    let mut keys: Vec<Vec<String>> = vec![Vec::new()];
    for column in columns {
        let members = row.cells.get(column).map(members).unwrap_or_default();
        keys = keys
            .into_iter()
            .flat_map(|prefix| {
                members.iter().map(move |member| {
                    let mut key = prefix.clone();
                    key.push(member.clone());
                    key
                })
            })
            .collect();
        if keys.is_empty() {
            return keys;
        }
    }
    keys
}

/// A cell's values in a form equal cells share: one string per member.
/// Resolve only joins columns of one kind (or relations to row ids, whose
/// members are both the row's UUID string), so the kind needs no tag.
fn members(cell: &Cell) -> Vec<String> {
    match cell {
        Cell::Text(text) => vec![text.clone()],
        Cell::Number(number) => vec![number.to_bits().to_string()],
        Cell::Bool(flag) => vec![flag.to_string()],
        Cell::Date(date) => vec![date.timestamp_millis().to_string()],
        Cell::Options(ids) => ids.iter().map(OptionId::to_string).collect(),
        Cell::Entities(ids) => ids.clone(),
        Cell::Row(id) => vec![id.to_string()],
    }
}
