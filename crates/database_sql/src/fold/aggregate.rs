//! Grouping rows and computing the select list's aggregates per group.

use std::collections::HashMap;

use uuid::Uuid;

use crate::resolve::{AggregateFunction, SelectItem};

use super::{Cell, CellKey, Row};

/// One output row of an aggregate shape.
#[derive(Debug, Clone, PartialEq)]
pub struct Group {
    /// The grouped value; `None` without `GROUP BY` or for empty cells.
    pub key: Option<Cell>,
    /// The select list evaluated for the group.
    pub cells: Vec<Option<Cell>>,
}

/// Group the rows (one group in all without `GROUP BY`) and evaluate every
/// item. Groups come out in first-seen order; sorting is the caller's.
pub fn groups(rows: Vec<Row>, group_by: Option<Uuid>, items: &[SelectItem]) -> Vec<Group> {
    let mut keys: Vec<Option<Cell>> = Vec::new();
    let mut members: Vec<Vec<Row>> = Vec::new();
    match group_by {
        None => {
            keys.push(None);
            members.push(rows);
        }
        Some(column) => {
            let mut positions: HashMap<Option<CellKey>, usize> = HashMap::new();
            for row in rows {
                let key = row
                    .cells
                    .get(&column)
                    .cloned()
                    .filter(|cell| !cell.is_empty());
                let position = *positions
                    .entry(key.as_ref().map(CellKey::from))
                    .or_insert_with(|| {
                        keys.push(key);
                        members.push(Vec::new());
                        keys.len() - 1
                    });
                members[position].push(row);
            }
        }
    }

    keys.into_iter()
        .zip(members)
        .map(|(key, rows)| Group {
            cells: items
                .iter()
                .map(|item| match item {
                    SelectItem::Column(_) => key.clone(),
                    SelectItem::Aggregate { function, column } => {
                        evaluate(*function, *column, &rows)
                    }
                })
                .collect(),
            key,
        })
        .collect()
}

/// SQL aggregate semantics: `COUNT(*)` counts rows, everything else skips
/// empty cells, and a numeric aggregate over nothing is `NULL`.
fn evaluate(function: AggregateFunction, column: Option<Uuid>, rows: &[Row]) -> Option<Cell> {
    let Some(column) = column else {
        return Some(Cell::Number(rows.len() as f64));
    };
    let present = rows
        .iter()
        .filter_map(|row| row.cells.get(&column))
        .filter(|cell| !cell.is_empty());
    match function {
        AggregateFunction::Count => Some(Cell::Number(present.count() as f64)),
        AggregateFunction::Sum | AggregateFunction::Avg => {
            let numbers: Vec<f64> = present
                .filter_map(|cell| match cell {
                    Cell::Number(number) => Some(*number),
                    _ => None,
                })
                .collect();
            if numbers.is_empty() {
                return None;
            }
            let sum: f64 = numbers.iter().sum();
            Some(Cell::Number(match function {
                AggregateFunction::Sum => sum,
                _ => sum / numbers.len() as f64,
            }))
        }
        AggregateFunction::Min | AggregateFunction::Max => {
            let mut best: Option<Cell> = None;
            for cell in present {
                let replace = match (&best, cell) {
                    (None, _) => true,
                    (Some(Cell::Number(current)), Cell::Number(candidate)) => {
                        if function == AggregateFunction::Min {
                            candidate < current
                        } else {
                            candidate > current
                        }
                    }
                    (Some(Cell::Date(current)), Cell::Date(candidate)) => {
                        if function == AggregateFunction::Min {
                            candidate < current
                        } else {
                            candidate > current
                        }
                    }
                    _ => false,
                };
                if replace {
                    best = Some(cell.clone());
                }
            }
            best
        }
    }
}
