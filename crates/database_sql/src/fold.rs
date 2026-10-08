//! Stage five: finish a [`Plan`] over the rows (or bins) the server returned.
//!
//! Pure: rows in, result rows out. Joins the relations, applies the residual
//! filter, groups and aggregates or projects, drops repeats for `DISTINCT`,
//! then sorts. SQL semantics where SQL has an opinion (`NULL` compares
//! false, `COUNT(column)` skips empty cells, `SUM` of nothing is `NULL`, a
//! join on a `NULL` matches nothing); Macro's where SQL does not (`LIKE`
//! ignores case, empty cells sort last, select values sort in option order,
//! a multi-valued join column matches by membership).

mod aggregate;
mod join;
mod predicate;
mod sort;
#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use models_databases::position::Position;
use models_databases::{Formula, OptionId, RowId};
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::catalog::Catalog;
use crate::formula;
use crate::resolve::{AggregateFunction, OrderKey, SelectItem, binding, column_key};
use crate::run::RunError;
use crate::split::{Plan, Shape};

/// A cell as fetched. An absent cell is `NULL`; an absent multi-valued cell
/// is the empty set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum Cell {
    /// Text or link.
    Text(String),
    /// A number.
    Number(f64),
    /// A checkbox.
    Bool(bool),
    /// A date-time.
    Date(DateTime<Utc>),
    /// The selected option ids; one for single-select columns.
    Options(Vec<OptionId>),
    /// The referenced entity ids; one for single-valued columns.
    Entities(Vec<String>),
    /// A table row's own id, the `row_id` column.
    Row(RowId),
}

impl Cell {
    /// A multi-valued cell with nothing in it, which reads as `NULL`.
    pub fn is_empty(&self) -> bool {
        matches!(self, Cell::Options(ids) if ids.is_empty())
            || matches!(self, Cell::Entities(ids) if ids.is_empty())
    }
}

/// A cell in a form that hashes, so equal cells share one key. A number is
/// keyed by its bits, with `-0` read as `0`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum CellKey {
    Text(String),
    Number(u64),
    Bool(bool),
    Date(DateTime<Utc>),
    Options(Vec<OptionId>),
    Entities(Vec<String>),
    Row(RowId),
}

impl From<&Cell> for CellKey {
    fn from(cell: &Cell) -> Self {
        match cell {
            Cell::Text(text) => CellKey::Text(text.clone()),
            Cell::Number(number) if *number == 0.0 => CellKey::Number(0.0_f64.to_bits()),
            Cell::Number(number) => CellKey::Number(number.to_bits()),
            Cell::Bool(checked) => CellKey::Bool(*checked),
            Cell::Date(date) => CellKey::Date(*date),
            Cell::Options(ids) => CellKey::Options(ids.clone()),
            Cell::Entities(ids) => CellKey::Entities(ids.clone()),
            Cell::Row(id) => CellKey::Row(*id),
        }
    }
}

/// One fetched row: the entity id and the cells the plan asked for. After
/// a join, the cells of every matched relation under their keys, with the
/// `FROM` row's id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Row {
    /// The row entity id.
    pub id: RowId,
    /// The row's place in its table, a fractional index that sorts as text;
    /// `None` for rows that are not table rows, such as people.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    /// Cells by column; a missing column is an empty cell.
    pub cells: HashMap<Uuid, Cell>,
}

/// One `groupSoup` bin: the grouped value and how many rows it holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Bin {
    /// The group's value; `None` for rows with an empty cell.
    pub key: Option<Cell>,
    /// Rows in the group.
    #[specta(type = u32)]
    pub count: u64,
}

/// The result: one `Vec` per row, one `Option<Cell>` per select item, in
/// select-list order.
pub type Table = Vec<Vec<Option<Cell>>>;

/// Finish a plan from the rows fetched for each relation, `FROM` first.
/// For a row shape, the second value is the `FROM` row behind each result
/// row, in result order.
pub fn fold_relations(
    catalog: &Catalog,
    plan: &Plan,
    mut fetched: Vec<Vec<Row>>,
) -> (Table, Vec<RowId>) {
    for (index, rows) in fetched.iter_mut().enumerate() {
        derive(catalog, plan, index, rows);
    }
    fold_joined(catalog, plan, join::join(plan, fetched))
}

/// Give the rows of relation `index` the cells of its table's derived
/// columns the plan reads, computed from their other cells.
fn derive(catalog: &Catalog, plan: &Plan, index: usize, rows: &mut [Row]) {
    let Some(table) = catalog
        .tables
        .iter()
        .find(|table| table.id == plan.relations[index].relation.table)
    else {
        return;
    };
    let key = |definition: Uuid| column_key(index, definition);
    let derived: Vec<(Uuid, &Formula)> = formula::derived(table)
        .map(|(column, formula)| (key(column.id), formula))
        .filter(|(derived_key, _)| binding(&plan.bindings, *derived_key).is_some())
        .collect();
    if derived.is_empty() {
        return;
    }
    for row in rows {
        for (derived_key, formula) in &derived {
            match formula::evaluate(table, formula, &row.cells, key) {
                Some(cell) => row.cells.insert(*derived_key, cell),
                None => row.cells.remove(derived_key),
            };
        }
    }
}

/// Finish a plan over rows that are already joined (or come from one
/// relation).
#[cfg(test)]
pub(crate) fn fold_rows(catalog: &Catalog, plan: &Plan, rows: Vec<Row>) -> Table {
    fold_joined(catalog, plan, rows).0
}

fn fold_joined(catalog: &Catalog, plan: &Plan, rows: Vec<Row>) -> (Table, Vec<RowId>) {
    let rows: Vec<Row> = match &plan.residual {
        Some(filter) => rows
            .into_iter()
            .filter(|row| predicate::holds(filter, row))
            .collect(),
        None => rows,
    };

    match &plan.shape {
        Shape::Rows(columns) => {
            let mut rows = rows;
            sort::rows(catalog, plan, &mut rows);
            let projected = rows.into_iter().map(|row| {
                let cells: Vec<Option<Cell>> = columns
                    .iter()
                    .map(|column| row.cells.get(column).cloned())
                    .collect();
                (row.id, cells)
            });
            let (ids, table): (Vec<RowId>, Table) = if plan.distinct {
                window(plan, distinct(projected, |(_, cells)| cells)).unzip()
            } else {
                window(plan, projected).unzip()
            };
            (table, ids)
        }
        Shape::Aggregate { group_by, items } => {
            let mut groups = aggregate::groups(rows, *group_by, items);
            sort::groups(catalog, plan, &mut groups, *group_by, items);
            let groups = if plan.distinct {
                distinct(groups.into_iter(), |group| &group.cells).collect()
            } else {
                groups
            };
            (
                window(plan, groups.into_iter().map(|group| group.cells)).collect(),
                Vec::new(),
            )
        }
    }
}

/// `OFFSET` then `LIMIT`, after ordering.
fn window<Item>(plan: &Plan, rows: impl Iterator<Item = Item>) -> impl Iterator<Item = Item> {
    rows.skip(plan.offset.unwrap_or(0) as usize)
        .take(plan.limit.map_or(usize::MAX, |limit| limit as usize))
}

/// Keep the first of every set of equal result rows, in order.
fn distinct<Item>(
    rows: impl Iterator<Item = Item>,
    cells: impl Fn(&Item) -> &[Option<Cell>],
) -> impl Iterator<Item = Item> {
    let mut seen: HashSet<Vec<Option<CellKey>>> = HashSet::new();
    rows.filter(move |row| {
        seen.insert(
            cells(row)
                .iter()
                .map(|cell| cell.as_ref().map(CellKey::from))
                .collect(),
        )
    })
}

/// Finish a `GroupSoup` plan from its bins, which answer only a group
/// column and `COUNT(*)`.
pub fn fold_bins(catalog: &Catalog, plan: &Plan, bins: Vec<Bin>) -> Result<Table, RunError> {
    let Shape::Aggregate { group_by, items } = &plan.shape else {
        return Err(RunError::NotAnsweredByBins);
    };
    let mut groups: Vec<aggregate::Group> = bins
        .into_iter()
        .map(|bin| {
            let cells = items
                .iter()
                .map(|item| match item {
                    SelectItem::Column(_) => Ok(bin.key.clone()),
                    SelectItem::Aggregate {
                        function: AggregateFunction::Count,
                        column: None,
                    } => Ok(Some(Cell::Number(bin.count as f64))),
                    SelectItem::Aggregate { .. } => Err(RunError::NotAnsweredByBins),
                })
                .collect::<Result<_, _>>()?;
            Ok(aggregate::Group {
                key: bin.key,
                cells,
            })
        })
        .collect::<Result<_, RunError>>()?;
    sort::groups(catalog, plan, &mut groups, *group_by, items);
    Ok(window(plan, groups.into_iter().map(|group| group.cells)).collect())
}

/// Where an `ORDER BY` key lives in a group's output.
fn group_order_index(
    key: &OrderKey,
    group_by: Option<Uuid>,
    items: &[SelectItem],
) -> Option<usize> {
    match key {
        OrderKey::Item(index) => Some(*index),
        OrderKey::Column(column) => {
            debug_assert_eq!(
                Some(*column),
                group_by,
                "resolve allows only the group column"
            );
            items
                .iter()
                .position(|item| *item == SelectItem::Column(*column))
        }
    }
}
