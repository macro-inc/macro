//! Derived columns' stored cells. A formula column's definition holds each
//! row's computed value, written by the one writer whenever a formula or a
//! cell it reads changes, so every reader sees a plain number or date
//! column. No op writes them, and the journal records none: undoing an
//! input derives them again.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use database_sql::catalog::{Column, Table};
use database_sql::fold::Cell;
use database_sql::formula;
use models_databases::{ColumnId, Formula};
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use crate::domain::catalog::{self, StorageTable};
use crate::domain::models::{PropertyDefinitionId, TableId};

/// How deep derived columns may nest, as the formula engine guards it.
const MAX_DEPTH: usize = 32;

/// Some derived columns of one table, with the table as their formulas
/// read it: what a write stores in their cells.
#[derive(Debug, Clone, PartialEq)]
pub struct Derivation {
    table: Table,
    derived: Vec<(PropertyDefinitionId, Formula)>,
}

impl Derivation {
    /// The derived columns of `table` that `changed` picks, or that read a
    /// column it picks, directly or through other derived columns; `None`
    /// when there are none.
    pub fn reading(table: &Table, changed: impl Fn(&Column) -> bool) -> Option<Self> {
        let derived: Vec<(PropertyDefinitionId, Formula)> = formula::derived(table)
            .filter(|(column, formula)| changed(column) || reads(table, formula, &changed, 0))
            .map(|(column, formula)| (column.id, formula.clone()))
            .collect();
        (!derived.is_empty()).then(|| Self {
            table: table.clone(),
            derived,
        })
    }

    /// Every derived column of `entry`; `None` when it has none.
    pub fn every(entry: &StorageTable) -> Option<Self> {
        Self::reading(&catalog::engine_table(entry, ""), |_| true)
    }

    /// The derived columns of `entry` that cells of the `written`
    /// definitions feed.
    pub fn fed_by(entry: &StorageTable, written: &[PropertyDefinitionId]) -> Option<Self> {
        if !entry
            .columns
            .iter()
            .any(|column| column.column.formula().is_some())
        {
            return None;
        }
        Self::reading(&catalog::engine_table(entry, ""), |column| {
            written.contains(&column.id)
        })
    }

    /// The table.
    pub fn table_id(&self) -> TableId {
        self.table.id
    }

    /// The definitions of the stored columns the formulas read, through
    /// nested formulas too.
    pub fn inputs(&self) -> Vec<PropertyDefinitionId> {
        let mut inputs = Vec::new();
        for (_, formula) in &self.derived {
            stored_inputs(&self.table, formula, &mut inputs, 0);
        }
        inputs
    }

    /// The definitions whose cells it computes.
    pub fn outputs(&self) -> Vec<PropertyDefinitionId> {
        self.derived
            .iter()
            .map(|(definition, _)| *definition)
            .collect()
    }

    /// A row's derived cells, from its stored cells by definition; `None`
    /// empties a cell.
    pub fn cells(
        &self,
        row: &HashMap<PropertyDefinitionId, PropertyValue>,
    ) -> Vec<(PropertyDefinitionId, Option<PropertyValue>)> {
        let cells: HashMap<Uuid, Cell> = row
            .iter()
            .filter_map(|(definition, value)| {
                let cell = match value {
                    PropertyValue::Num(number) => Cell::Number(*number),
                    PropertyValue::Date(date) => Cell::Date(*date),
                    _ => return None,
                };
                Some((*definition, cell))
            })
            .collect();
        self.derived
            .iter()
            .map(|(definition, formula)| {
                let value = match formula::evaluate(&self.table, formula, &cells, |id| id) {
                    Some(Cell::Number(number)) => Some(PropertyValue::Num(number)),
                    Some(Cell::Date(date)) => Some(PropertyValue::Date(date)),
                    _ => None,
                };
                (*definition, value)
            })
            .collect()
    }
}

fn placement(table: &Table, column: ColumnId) -> Option<&Column> {
    table
        .columns
        .iter()
        .find(|candidate| candidate.placement == column)
}

/// Whether `formula` reads a column `changed` picks, directly or through
/// the derived columns it reads.
fn reads(
    table: &Table,
    formula: &Formula,
    changed: &impl Fn(&Column) -> bool,
    depth: usize,
) -> bool {
    depth <= MAX_DEPTH
        && formula.columns().into_iter().any(|column| {
            placement(table, column).is_some_and(|found| {
                changed(found)
                    || found
                        .formula
                        .as_ref()
                        .is_some_and(|inner| reads(table, inner, changed, depth + 1))
            })
        })
}

/// Collect the definitions of the stored columns `formula` reads, through
/// the derived columns it reads, each once.
fn stored_inputs(
    table: &Table,
    formula: &Formula,
    inputs: &mut Vec<PropertyDefinitionId>,
    depth: usize,
) {
    if depth > MAX_DEPTH {
        return;
    }
    for column in formula.columns() {
        let Some(found) = placement(table, column) else {
            continue;
        };
        match &found.formula {
            Some(inner) => stored_inputs(table, inner, inputs, depth + 1),
            None if !inputs.contains(&found.id) => inputs.push(found.id),
            None => {}
        }
    }
}
