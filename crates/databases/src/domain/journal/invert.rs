//! Inverting a change: the ops that put back what a batch's ops on one table
//! changed, built from the before-image.

use std::collections::{BTreeMap, BTreeSet};

use models_databases::views::{LaneKey, NewView, RequestedLayout};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, DatabaseOp, NewColumn, NewOption, OptionId,
    OptionRef, PropertyId, RowChange, RowChanges, RowId, RowsChange, TableChange, TableId,
    ViewChange, ViewId,
};

use super::{Before, ChangeInverse, RestoredRow};
use crate::domain::models::{DatabaseView, Write};

/// One op of a batch with what it planned and committed.
#[derive(Debug, Clone, Copy)]
pub struct Planned<'batch> {
    /// The op, as sent.
    pub op: &'batch DatabaseOp,
    /// Its write.
    pub write: &'batch Write,
    /// The rows it inserted.
    pub inserted: &'batch [RowId],
}

/// The ops that undo `planned`, applied in order: each op's inverse, newest
/// first, then the orders of columns, views and tables the batch disturbed,
/// put back. A table's removal is not undone: its rows, columns and views go
/// with it, and nothing brings them back yet.
///
/// What an op names that an earlier op of the batch created has no
/// before-image, and needs no inverse of its own: the creation's inverse
/// removes it. Something created and removed in the same batch is left
/// alone.
pub fn invert(planned: &[Planned<'_>], before: &Before) -> ChangeInverse {
    let mut inverse = Inverter {
        before,
        inverse: ChangeInverse::default(),
        column_orders: BTreeSet::new(),
        view_orders: BTreeSet::new(),
        table_order: false,
        deleted_tables: BTreeSet::new(),
        cells: BTreeMap::new(),
    };
    for (index, step) in planned.iter().enumerate().rev() {
        let later = &planned[index + 1..];
        inverse.step(step, later);
    }
    inverse.finish();
    inverse.order_dependencies();
    inverse.inverse
}

struct Inverter<'before> {
    before: &'before Before,
    inverse: ChangeInverse,
    column_orders: BTreeSet<TableId>,
    view_orders: BTreeSet<TableId>,
    table_order: bool,
    deleted_tables: BTreeSet<TableId>,
    cells: BTreeMap<TableId, BTreeMap<RowId, BTreeMap<ColumnId, CellValue>>>,
}

impl Inverter<'_> {
    fn order_dependencies(&mut self) {
        let mut ops: Vec<_> = std::mem::take(&mut self.inverse.ops)
            .into_iter()
            .enumerate()
            .collect();
        ops.sort_by_key(|(_, op)| match op {
            DatabaseOp::Rows {
                change: RowsChange::Insert { .. },
                ..
            } => 1,
            DatabaseOp::Rows {
                change: RowsChange::Update { .. },
                ..
            }
            | DatabaseOp::View {
                change: ViewChange::MoveCard { .. },
                ..
            } => 2,
            DatabaseOp::Column {
                change: ColumnChange::DeleteOption { .. },
                ..
            } => 3,
            DatabaseOp::ReorderTables { .. }
            | DatabaseOp::Table {
                change: TableChange::ReorderColumns { .. } | TableChange::ReorderViews { .. },
                ..
            } => 4,
            _ => 0,
        });
        let mut rows = std::mem::take(&mut self.inverse.restored_rows);
        let mut rebinds = std::mem::take(&mut self.inverse.rebinds);
        for (previous, op) in ops {
            let index = self.inverse.ops.len();
            if let Some(restored) = rows.remove(&previous) {
                self.inverse.restored_rows.insert(index, restored);
            }
            if let Some(definition) = rebinds.remove(&previous) {
                self.inverse.rebinds.insert(index, definition);
            }
            self.inverse.ops.push(op);
        }
    }
    fn restore_rows(&mut self, table: TableId, rows: Vec<RowChange>) {
        for row in rows {
            let cells = self
                .cells
                .entry(table)
                .or_default()
                .entry(row.row)
                .or_default();
            for cell in row.cells {
                cells.insert(cell.column, cell.value);
            }
        }
    }
    fn push(&mut self, op: DatabaseOp) -> usize {
        self.inverse.ops.push(op);
        self.inverse.ops.len() - 1
    }

    fn step(&mut self, step: &Planned<'_>, later: &[Planned<'_>]) {
        if matches!(step.write, Write::Unchanged { .. }) {
            return;
        }
        if let Write::UpdateView {
            view,
            regrouped: true,
        } = step.write
            && self
                .before
                .cards
                .get(&view.id)
                .is_some_and(|cards| !cards.is_empty())
        {
            self.inverse.incomplete = true;
        }
        match step.op {
            DatabaseOp::ReorderTables { .. } => self.table_order = true,
            DatabaseOp::Table { table, change } => self.table(*table, change, later),
            DatabaseOp::Column {
                table,
                column,
                change,
            } => self.column(*table, *column, change, step.write, later),
            DatabaseOp::Rows { table, change } => self.rows(*table, change, step.inserted, later),
            DatabaseOp::View {
                table,
                view,
                change,
            } => self.view(*table, *view, change, later),
        }
    }

    fn table(&mut self, table: TableId, change: &TableChange, later: &[Planned<'_>]) {
        match change {
            TableChange::Create { .. } => {
                if !later.iter().any(|step| deletes_table(step.op, table)) {
                    self.push(DatabaseOp::Table {
                        table,
                        change: TableChange::Delete,
                    });
                }
            }
            TableChange::Rename { name, .. } => {
                if later.iter().any(|step| !matches!(step.write, Write::Unchanged { .. }) && matches!(step.op, DatabaseOp::Table { table: named, change: TableChange::Rename { .. } } if *named == table)) {
                    return;
                }
                if let Some(image) = self.before.schema.table(table) {
                    self.push(DatabaseOp::Table {
                        table,
                        change: TableChange::Rename {
                            name: image.name.clone(),
                            previous_name: Some(name.trim().to_string()),
                        },
                    });
                }
            }
            TableChange::Delete => {
                self.deleted_tables.insert(table);
            }
            TableChange::ReorderColumns { .. } => {
                self.column_orders.insert(table);
            }
            TableChange::ReorderViews { .. } => {
                self.view_orders.insert(table);
            }
        }
    }

    fn column(
        &mut self,
        table: TableId,
        column: ColumnId,
        change: &ColumnChange,
        write: &Write,
        later: &[Planned<'_>],
    ) {
        let image = self.before.schema.column(column).cloned();
        match change {
            ColumnChange::Create { .. } => {
                if !later.iter().any(|step| deletes_column(step.op, column)) {
                    self.push(DatabaseOp::Column {
                        table,
                        column,
                        change: ColumnChange::Delete,
                    });
                }
            }
            ColumnChange::Rename { name, .. } => {
                if later.iter().any(|step| !matches!(step.write, Write::Unchanged { .. }) && matches!(step.op, DatabaseOp::Column { column: named, change: ColumnChange::Rename { .. }, .. } if *named == column)) {
                    return;
                }
                if let Some(image) = image {
                    self.push(DatabaseOp::Column {
                        table,
                        column,
                        change: ColumnChange::Rename {
                            name: image.name,
                            previous_name: Some(name.trim().to_string()),
                        },
                    });
                }
            }
            ColumnChange::ChangeType { .. } => {
                let Some(image) = image else { return };
                let Some(kind) = image.kind else { return };
                let index = self.push(DatabaseOp::Column {
                    table,
                    column,
                    change: ColumnChange::ChangeType { to: kind },
                });
                self.inverse.rebinds.insert(index, image.definition);
                self.restore_cells(table, column, |_| true);
                if let Write::ReplaceColumn { views, .. } = write {
                    self.restore_views(table, views);
                }
            }
            ColumnChange::Delete => {
                let Some(image) = image else { return };
                self.inverse.restored_columns.insert(
                    column,
                    super::RestoredColumn {
                        kind: image.kind,
                        infer_type: image.infer_type,
                        nullable: image.nullable,
                    },
                );
                self.push(DatabaseOp::Column {
                    table,
                    column,
                    change: ColumnChange::Create {
                        definition: NewColumn::Existing {
                            property: PropertyId::from_uuid(image.definition),
                        },
                        after: None,
                    },
                });
                if image.name != image.definition_name {
                    self.push(DatabaseOp::Column {
                        table,
                        column,
                        change: ColumnChange::Rename {
                            name: image.name.clone(),
                            previous_name: None,
                        },
                    });
                }
                self.restore_cells(table, column, |_| true);
                if let Write::DeleteColumn { views, .. } = write {
                    self.restore_views(table, views);
                }
                self.column_orders.insert(table);
            }
            ColumnChange::AddOptions { .. } => {
                let Write::AddOptions { options, .. } = write else {
                    return;
                };
                for (option, _) in options {
                    if !later
                        .iter()
                        .any(|step| deletes_option(step.op, column, *option))
                    {
                        self.push(DatabaseOp::Column {
                            table,
                            column,
                            change: ColumnChange::DeleteOption { option: *option },
                        });
                    }
                }
            }
            ColumnChange::UpdateOption {
                option,
                label,
                color,
            } => {
                let Some(old) = image.and_then(|image| {
                    image
                        .options
                        .into_iter()
                        .find(|candidate| candidate.id == *option)
                }) else {
                    return;
                };
                self.push(DatabaseOp::Column {
                    table,
                    column,
                    change: ColumnChange::UpdateOption {
                        option: *option,
                        label: label.as_ref().map(|_| old.label.clone()),
                        color: color.as_ref().map(|_| old.color.clone()),
                    },
                });
            }
            ColumnChange::DeleteOption { option } => {
                if self.before.incomplete_options.contains(option)
                    || self
                        .before
                        .cards
                        .values()
                        .flatten()
                        .any(|card| card.lane == LaneKey::Option(*option))
                {
                    self.inverse.incomplete = true;
                }
                let Some(old) = image.and_then(|image| {
                    image
                        .options
                        .into_iter()
                        .find(|candidate| candidate.id == *option)
                }) else {
                    return;
                };
                self.push(DatabaseOp::Column {
                    table,
                    column,
                    change: ColumnChange::AddOptions {
                        options: vec![NewOption {
                            id: old.id,
                            label: old.label.clone(),
                        }],
                    },
                });
                self.push(DatabaseOp::Column {
                    table,
                    column,
                    change: ColumnChange::UpdateOption {
                        option: old.id,
                        label: None,
                        color: Some(old.color.clone()),
                    },
                });
                let option = *option;
                self.restore_cells(table, column, |value| holds_option(value, option));
                if let Write::DeleteOption { views, .. } = write {
                    self.restore_views(table, views);
                }
            }
        }
    }

    /// Write back a column's old cells on the rows `keep` picks.
    fn restore_cells(
        &mut self,
        table: TableId,
        column: ColumnId,
        keep: impl Fn(&CellValue) -> bool,
    ) {
        let Some(cells) = self.before.column_cells.get(&column) else {
            return;
        };
        let rows: Vec<RowChange> = cells
            .iter()
            .filter(|(_, value)| keep(value))
            .map(|(row, value)| RowChange {
                row: *row,
                cells: vec![CellWrite {
                    column,
                    value: value.clone(),
                }],
            })
            .collect();
        if rows.is_empty() {
            return;
        }
        self.restore_rows(table, rows);
    }

    /// Put back the views a schema change rewrote, as they were.
    fn restore_views(&mut self, table: TableId, rewritten: &[DatabaseView]) {
        for rewritten in rewritten {
            if rewritten.table_id != table {
                self.inverse.incomplete = true;
                continue;
            }
            if let Some(old) = self.before.schema.view(rewritten.id).cloned() {
                self.push(view_update(table, &old));
            }
        }
    }

    fn rows(
        &mut self,
        table: TableId,
        change: &RowsChange,
        inserted: &[RowId],
        later: &[Planned<'_>],
    ) {
        match change {
            RowsChange::Insert { .. } => {
                let rows: Vec<RowId> = inserted
                    .iter()
                    .copied()
                    .filter(|row| !later.iter().any(|step| deletes_row(step.op, *row)))
                    .collect();
                if !rows.is_empty() {
                    self.push(DatabaseOp::Rows {
                        table,
                        change: RowsChange::Delete { rows },
                    });
                }
            }
            RowsChange::Update { changes } => {
                let written: Vec<(RowId, Vec<ColumnId>)> = match changes {
                    RowChanges::Uniform { rows, cells } => rows
                        .iter()
                        .map(|row| (*row, cells.iter().map(|cell| cell.column).collect()))
                        .collect(),
                    RowChanges::PerRow { rows } => rows
                        .iter()
                        .map(|row| (row.row, row.cells.iter().map(|cell| cell.column).collect()))
                        .collect(),
                };
                let rows: Vec<RowChange> = written
                    .into_iter()
                    .filter_map(|(row, columns)| {
                        let image = self.before.rows.get(&row)?;
                        Some(RowChange {
                            row,
                            cells: columns
                                .into_iter()
                                .map(|column| CellWrite {
                                    column,
                                    value: image
                                        .cells
                                        .get(&column)
                                        .cloned()
                                        .unwrap_or(CellValue::Clear),
                                })
                                .collect(),
                        })
                    })
                    .collect();
                if !rows.is_empty() {
                    self.restore_rows(table, rows);
                }
            }
            RowsChange::Delete { rows } => {
                if self
                    .before
                    .cards
                    .values()
                    .flatten()
                    .any(|card| rows.contains(&card.row))
                {
                    self.inverse.incomplete = true;
                }
                let images: Vec<(RowId, &super::RowImage)> = rows
                    .iter()
                    .filter_map(|row| Some((*row, self.before.rows.get(row)?)))
                    .collect();
                if images.is_empty() {
                    return;
                }
                let cells = images
                    .iter()
                    .map(|(_, image)| {
                        image
                            .cells
                            .iter()
                            .map(|(column, value)| CellWrite {
                                column: *column,
                                value: value.clone(),
                            })
                            .collect()
                    })
                    .collect();
                let restored = images
                    .iter()
                    .map(|(row, image)| RestoredRow {
                        id: *row,
                        position: image.position.clone(),
                    })
                    .collect();
                let index = self.push(DatabaseOp::Rows {
                    table,
                    change: RowsChange::Insert { rows: cells },
                });
                self.inverse.restored_rows.insert(index, restored);
            }
        }
    }

    fn view(&mut self, table: TableId, view: ViewId, change: &ViewChange, later: &[Planned<'_>]) {
        let image = self.before.schema.view(view).cloned();
        match change {
            ViewChange::Create { .. } => {
                if !later.iter().any(|step| deletes_view(step.op, view)) {
                    self.push(DatabaseOp::View {
                        table,
                        view,
                        change: ViewChange::Delete,
                    });
                }
            }
            ViewChange::Update { .. } => {
                if let Some(image) = image {
                    self.push(view_update(table, &image));
                }
            }
            ViewChange::Delete => {
                let Some(image) = image else { return };
                if self
                    .before
                    .cards
                    .get(&view)
                    .is_some_and(|cards| !cards.is_empty())
                {
                    self.inverse.incomplete = true;
                }
                self.push(DatabaseOp::View {
                    table,
                    view,
                    change: ViewChange::Create {
                        view: NewView {
                            name: image.name.clone(),
                            query: image.query.clone(),
                            layout: RequestedLayout::from(image.layout.clone()),
                        },
                    },
                });
                self.view_orders.insert(table);
            }
            ViewChange::MoveCard { row, .. } => {
                if let Some(op) = self.card_back(table, view, *row) {
                    self.push(op);
                }
            }
        }
    }

    /// The move that puts a card back in its old lane, between the cards
    /// that were on either side of it.
    fn card_back(&self, table: TableId, view: ViewId, row: RowId) -> Option<DatabaseOp> {
        let board = self.before.schema.view(view)?;
        let group_by = board.layout.group_by()?;
        let lane = LaneKey::of_cell(self.before.rows.get(&row)?.cells.get(&group_by));
        let mut placed: Vec<_> = self
            .before
            .cards
            .get(&view)
            .into_iter()
            .flatten()
            .filter(|card| card.lane == lane)
            .collect();
        placed.sort_by(|left, right| left.position.cmp(&right.position));
        let (before, after) = match placed.iter().position(|card| card.row == row) {
            Some(at) => (
                at.checked_sub(1).map(|previous| placed[previous].row),
                placed.get(at + 1).map(|next| next.row),
            ),
            None => (placed.last().map(|card| card.row), None),
        };
        Some(DatabaseOp::View {
            table,
            view,
            change: ViewChange::MoveCard {
                row,
                lane,
                before,
                after,
            },
        })
    }

    /// Put back the orders the batch disturbed, once everything it removed
    /// is back and everything it added is gone.
    fn finish(&mut self) {
        // Restore dependent values only after every option and column is
        // back. Multiple writes to a cell collapse to its pre-batch value.
        for (table, rows) in std::mem::take(&mut self.cells) {
            let rows = rows
                .into_iter()
                .filter_map(|(row, cells)| {
                    if self
                        .inverse
                        .restored_rows
                        .values()
                        .flatten()
                        .any(|restored| restored.id == row)
                    {
                        return None;
                    }
                    if self
                        .inverse
                        .ops
                        .iter()
                        .any(|op| deletes_row(op, row) || deletes_table(op, table))
                    {
                        return None;
                    }
                    let cells: Vec<_> = cells
                        .into_iter()
                        .filter(|(column, _)| {
                            !self
                                .inverse
                                .ops
                                .iter()
                                .any(|op| deletes_column(op, *column))
                        })
                        .map(|(column, value)| CellWrite { column, value })
                        .collect();
                    (!cells.is_empty()).then_some(RowChange { row, cells })
                })
                .collect::<Vec<_>>();
            if !rows.is_empty() {
                self.push(DatabaseOp::Rows {
                    table,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow { rows },
                    },
                });
            }
        }
        let schema = &self.before.schema;
        for table in std::mem::take(&mut self.column_orders) {
            let order: Vec<ColumnId> = schema.columns_of(table).map(|column| column.id).collect();
            if !order.is_empty() {
                self.inverse.ops.push(DatabaseOp::Table {
                    table,
                    change: TableChange::ReorderColumns { order },
                });
            }
        }
        for table in std::mem::take(&mut self.view_orders) {
            let order: Vec<ViewId> = schema
                .views
                .iter()
                .filter(|view| view.table_id == table)
                .map(|view| view.id)
                .collect();
            if !order.is_empty() {
                self.inverse.ops.push(DatabaseOp::Table {
                    table,
                    change: TableChange::ReorderViews { order },
                });
            }
        }
        if self.table_order {
            let order: Vec<TableId> = schema
                .tables
                .iter()
                .map(|table| table.id)
                .filter(|table| !self.deleted_tables.contains(table))
                .collect();
            self.inverse.ops.push(DatabaseOp::ReorderTables { order });
        }
    }
}

/// The op that gives a view back its name, query and layout.
fn view_update(table: TableId, view: &DatabaseView) -> DatabaseOp {
    DatabaseOp::View {
        table,
        view: view.id,
        change: ViewChange::Update {
            name: Some(view.name.clone()),
            query: Some(view.query.clone()),
            layout: Some(RequestedLayout::from(view.layout.clone())),
        },
    }
}

fn holds_option(value: &CellValue, option: OptionId) -> bool {
    matches!(value, CellValue::Options(options) if options.contains(&OptionRef::Id(option)))
}

fn deletes_table(op: &DatabaseOp, table: TableId) -> bool {
    matches!(op, DatabaseOp::Table { table: named, change: TableChange::Delete } if *named == table)
}

fn deletes_column(op: &DatabaseOp, column: ColumnId) -> bool {
    matches!(op, DatabaseOp::Column { column: named, change: ColumnChange::Delete, .. } if *named == column)
}

fn deletes_option(op: &DatabaseOp, column: ColumnId, option: OptionId) -> bool {
    matches!(
        op,
        DatabaseOp::Column { column: named, change: ColumnChange::DeleteOption { option: deleted }, .. }
            if *named == column && *deleted == option
    ) || deletes_column(op, column)
}

fn deletes_view(op: &DatabaseOp, view: ViewId) -> bool {
    matches!(op, DatabaseOp::View { view: named, change: ViewChange::Delete, .. } if *named == view)
}

fn deletes_row(op: &DatabaseOp, row: RowId) -> bool {
    matches!(op, DatabaseOp::Rows { change: RowsChange::Delete { rows }, .. } if rows.contains(&row))
}
