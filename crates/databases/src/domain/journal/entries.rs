//! Which journal entries a committed batch makes, and what its before-image
//! must read.

use std::collections::{BTreeMap, HashMap};

use models_databases::{
    CellValue, ColumnChange, ColumnId, DatabaseId, DatabaseOp, OptionRef, RowId, TableChange,
    TableId, TableVersion,
};

use super::{
    Before, CellImage, ColumnChangeKind, ColumnTouch, JournalEntry, Planned, Reads, RowChangeKind,
    RowTouch, cell_value, invert,
};
use crate::domain::models::{PropertyDefinitionId, Write, Writes};

/// What the adapter reads under the batch's locks, before it writes.
pub fn reads(writes: &Writes) -> Reads {
    let mut reads = Reads::default();
    for (op, write) in writes.journal.ops.iter().zip(&writes.writes) {
        match write {
            Write::UpdateRows { rows, .. } => {
                reads.rows.extend(rows.iter().map(|(row, _)| *row));
            }
            Write::DeleteRows { table_id, rows, .. } => {
                reads.rows.extend(rows.iter().copied());
                reads.boards.extend(
                    writes
                        .journal
                        .schema
                        .views
                        .iter()
                        .filter(|view| view.table_id == *table_id)
                        .map(|view| view.id),
                );
            }
            Write::MoveCard { view_id, row, .. } => {
                reads.rows.push(*row);
                reads.boards.push(*view_id);
            }
            Write::DeleteView { view_id, .. } => reads.boards.push(*view_id),
            Write::UpdateView {
                view,
                regrouped: true,
            } => reads.boards.push(view.id),
            Write::DeleteColumn {
                table_id,
                column_id,
                definition_id,
                ..
            } => reads.columns.push((*table_id, *column_id, *definition_id)),
            Write::ReplaceColumn {
                table_id,
                replacement,
                ..
            } => reads.columns.push((
                *table_id,
                replacement.column.id,
                replacement.column.property_definition_id,
            )),
            Write::DeleteOption {
                table_id,
                definition_id,
                tables,
                ..
            } => {
                reads.boards.extend(
                    writes
                        .journal
                        .schema
                        .views
                        .iter()
                        .filter(|view| tables.contains(&view.table_id))
                        .map(|view| view.id),
                );
                if let DatabaseOp::Column { column, .. } = op {
                    reads.columns.push((*table_id, *column, *definition_id));
                }
            }
            _ => {}
        }
    }
    reads.rows.sort();
    reads.rows.dedup();
    reads.columns.sort();
    reads.columns.dedup();
    reads.boards.sort();
    reads.boards.dedup();
    reads
}

/// The journal entries of a committed batch: one per table version it
/// produced, and one for each table it removed, at the version the removal
/// would have bumped it to.
///
/// An op belongs to the table it names (a reorder of the database's tables,
/// to the first it names). A table versioned only because an op elsewhere
/// changed what it shows, a shared property's options or a relation into
/// it, gets an entry of its own with no ops, so its journal has no gap.
pub fn entries(
    writes: &Writes,
    before: &Before,
    inserted: &[Vec<RowId>],
    table_versions: &HashMap<TableId, TableVersion>,
) -> Vec<JournalEntry> {
    let ops = &writes.journal.ops;
    let mut versions: BTreeMap<TableId, (DatabaseId, TableVersion)> = table_versions
        .iter()
        .map(|(table, version)| {
            (
                *table,
                (
                    related_database(writes, *table).unwrap_or(writes.database_id),
                    *version,
                ),
            )
        })
        .collect();
    for write in &writes.writes {
        if let Write::DeleteTable { table_id, version } = write {
            versions.insert(*table_id, (writes.database_id, TableVersion(version.0 + 1)));
        }
    }
    let definitions = column_definitions(writes, before);
    versions
        .into_iter()
        .map(|(table, (database_id, version))| {
            let own: Vec<usize> = (0..ops.len())
                .filter(|index| owner(&ops[*index]) == Some(table))
                .collect();
            let planned: Vec<Planned<'_>> = own
                .iter()
                .map(|index| Planned {
                    op: &ops[*index],
                    write: &writes.writes[*index],
                    inserted: inserted.get(*index).map_or(&[][..], Vec::as_slice),
                })
                .collect();
            let mut inverse = invert(&planned, before);
            inverse.before = before_cells(before, table);
            let (rows, after) = row_touches(&planned, before, table, &definitions);
            inverse.after = after;
            let mut columns = column_touches(&planned);
            if own.is_empty() {
                columns = related_touches(writes, before, table);
            }
            JournalEntry {
                database_id,
                table,
                version,
                ops: own.iter().map(|index| ops[*index].clone()).collect(),
                inverse,
                rows,
                columns,
            }
        })
        .collect()
}

/// The table an op's change is recorded under.
fn owner(op: &DatabaseOp) -> Option<TableId> {
    match op {
        DatabaseOp::ReorderTables { order } => order.first().copied(),
        op => op.table(),
    }
}

/// The database a related table belongs to, when a relation's removal
/// versioned it from outside the batch's database.
fn related_database(writes: &Writes, table: TableId) -> Option<DatabaseId> {
    writes.writes.iter().find_map(|write| match write {
        Write::DeleteColumn {
            related: Some((database, related)),
            ..
        } if *related == table => Some(*database),
        _ => None,
    })
}

/// Which column of its table each definition a batch writes is bound to:
/// the schema's, then those the batch binds.
fn column_definitions(
    writes: &Writes,
    before: &Before,
) -> HashMap<(TableId, PropertyDefinitionId), ColumnId> {
    let mut definitions: HashMap<(TableId, PropertyDefinitionId), ColumnId> = before
        .schema
        .columns
        .iter()
        .map(|column| ((column.table, column.definition), column.id))
        .collect();
    for write in &writes.writes {
        match write {
            Write::CreateColumn { column, .. } => {
                definitions.insert((column.table_id, column.property_definition_id), column.id);
            }
            Write::ReplaceColumn {
                table_id,
                replacement,
                ..
            } => {
                definitions.insert(
                    (*table_id, replacement.definition_id),
                    replacement.column.id,
                );
            }
            _ => {}
        }
    }
    definitions
}

/// The before-image's cells of one table, flat.
fn before_cells(before: &Before, table: TableId) -> CellImage {
    let mut cells: BTreeMap<RowId, BTreeMap<ColumnId, CellValue>> = before
        .rows
        .iter()
        .filter(|(_, image)| image.table == table)
        .map(|(row, image)| (*row, image.cells.clone()))
        .collect();
    for (column, values) in &before.column_cells {
        if before
            .schema
            .column(*column)
            .is_none_or(|image| image.table != table)
        {
            continue;
        }
        for (row, value) in values {
            cells
                .entry(*row)
                .or_default()
                .insert(*column, value.clone());
        }
    }
    cells.retain(|_, row| !row.is_empty());
    CellImage { cells }
}

/// The rows an entry's ops touched, and the cells they wrote.
fn row_touches(
    planned: &[Planned<'_>],
    before: &Before,
    table: TableId,
    definitions: &HashMap<(TableId, PropertyDefinitionId), ColumnId>,
) -> (Vec<RowTouch>, CellImage) {
    let mut touches: BTreeMap<RowId, (Vec<RowChangeKind>, Vec<ColumnId>)> = BTreeMap::new();
    let mut after = before_cells(before, table);
    let mut touch = |row: RowId, kind: RowChangeKind, columns: &[ColumnId]| {
        let entry = touches.entry(row).or_default();
        entry.0.push(kind);
        for column in columns {
            if !entry.1.contains(column) {
                entry.1.push(*column);
            }
        }
    };
    let column_of =
        |definition: PropertyDefinitionId| definitions.get(&(table, definition)).copied();
    for step in planned {
        match step.write {
            Write::InsertRows { rows, .. } => {
                for (row, cells) in step.inserted.iter().zip(rows) {
                    let mut columns = Vec::new();
                    for (definition, value) in cells {
                        let Some(column) = column_of(*definition) else {
                            continue;
                        };
                        columns.push(column);
                        if let Some(value) = cell_value(value) {
                            after.cells.entry(*row).or_default().insert(column, value);
                        }
                    }
                    touch(*row, RowChangeKind::Insert, &columns);
                }
            }
            Write::UpdateRows { rows, .. } => {
                for (row, cells) in rows {
                    let mut columns = Vec::new();
                    for (definition, value) in cells {
                        let Some(column) = column_of(*definition) else {
                            continue;
                        };
                        columns.push(column);
                        let written = after.cells.entry(*row).or_default();
                        match value.as_ref().and_then(cell_value) {
                            Some(value) => {
                                written.insert(column, value);
                            }
                            None => {
                                written.remove(&column);
                            }
                        }
                    }
                    touch(*row, RowChangeKind::Update, &columns);
                }
            }
            Write::DeleteRows { rows, .. } => {
                for row in rows {
                    let columns: Vec<ColumnId> = before
                        .rows
                        .get(row)
                        .map(|image| image.cells.keys().copied().collect())
                        .unwrap_or_default();
                    after.cells.remove(row);
                    touch(*row, RowChangeKind::Delete, &columns);
                }
            }
            Write::MoveCard {
                row,
                cell: (definition, value),
                ..
            } => {
                if let Some(column) = column_of(*definition) {
                    let written = after.cells.entry(*row).or_default();
                    match value.as_ref().and_then(cell_value) {
                        Some(value) => {
                            written.insert(column, value);
                        }
                        None => {
                            written.remove(&column);
                        }
                    }
                    touch(*row, RowChangeKind::Update, &[column]);
                }
            }
            Write::DeleteColumn { column_id, .. } => {
                for row in column_rows(before, *column_id, |_| true) {
                    if let Some(cells) = after.cells.get_mut(&row) {
                        cells.remove(column_id);
                    }
                    touch(row, RowChangeKind::Update, &[*column_id]);
                }
            }
            Write::ReplaceColumn { replacement, .. } => {
                let column = replacement.column.id;
                for row in column_rows(before, column, |_| true) {
                    if let Some(cells) = after.cells.get_mut(&row) {
                        cells.remove(&column);
                    }
                    touch(row, RowChangeKind::Update, &[column]);
                }
                for (row, value) in &replacement.values {
                    if let Some(value) = cell_value(value) {
                        after.cells.entry(*row).or_default().insert(column, value);
                    }
                    touch(*row, RowChangeKind::Update, &[column]);
                }
            }
            Write::DeleteOption { option_id, .. } => {
                if let DatabaseOp::Column { column, .. } = step.op {
                    let candidates: Vec<_> = after
                        .cells
                        .iter()
                        .filter_map(|(row, values)| Some((*row, values.get(column)?.clone())))
                        .collect();
                    for (row, value) in candidates {
                        let CellValue::Options(mut options) = value else {
                            continue;
                        };
                        if !options.contains(&OptionRef::Id(*option_id)) {
                            continue;
                        }
                        options.retain(|option| *option != OptionRef::Id(*option_id));
                        let written = after.cells.entry(row).or_default();
                        if options.is_empty() {
                            written.remove(column);
                        } else {
                            written.insert(*column, CellValue::Options(options));
                        }
                        touch(row, RowChangeKind::Update, &[*column]);
                    }
                }
            }
            _ => {}
        }
    }
    after.cells.retain(|row, values| {
        values.retain(|column, _| {
            touches
                .get(row)
                .is_some_and(|(_, columns)| columns.contains(column))
        });
        !values.is_empty()
    });
    let rows = touches
        .into_iter()
        .filter_map(|(row, (kinds, columns))| {
            let inserted = kinds.contains(&RowChangeKind::Insert);
            let deleted = kinds.contains(&RowChangeKind::Delete);
            let kind = match (inserted, deleted) {
                // Added and removed by the same batch: nothing to record.
                (true, true) => return None,
                (true, false) => RowChangeKind::Insert,
                (false, true) => RowChangeKind::Delete,
                (false, false) => RowChangeKind::Update,
            };
            Some(RowTouch { row, kind, columns })
        })
        .collect();
    (rows, after)
}

/// The rows of a column's before-image whose value `keep` picks.
fn column_rows(before: &Before, column: ColumnId, keep: impl Fn(&CellValue) -> bool) -> Vec<RowId> {
    before
        .column_cells
        .get(&column)
        .into_iter()
        .flatten()
        .filter(|(_, value)| keep(value))
        .map(|(row, _)| *row)
        .collect()
}

/// The columns an entry's ops changed.
fn column_touches(planned: &[Planned<'_>]) -> Vec<ColumnTouch> {
    let mut touches = Vec::new();
    for step in planned {
        if matches!(step.write, Write::Unchanged { .. }) {
            continue;
        }
        match step.op {
            DatabaseOp::Column { column, change, .. } => touches.push(ColumnTouch {
                column: *column,
                kind: match change {
                    ColumnChange::Create { .. } => ColumnChangeKind::Create,
                    ColumnChange::Rename { .. } => ColumnChangeKind::Rename,
                    ColumnChange::ChangeType { .. } => ColumnChangeKind::ChangeType,
                    ColumnChange::Delete => ColumnChangeKind::Delete,
                    ColumnChange::AddOptions { .. } => ColumnChangeKind::AddOptions,
                    ColumnChange::UpdateOption { .. } => ColumnChangeKind::UpdateOption,
                    ColumnChange::DeleteOption { .. } => ColumnChangeKind::DeleteOption,
                },
            }),
            DatabaseOp::Table {
                change: TableChange::ReorderColumns { order },
                ..
            } => touches.extend(order.iter().map(|column| ColumnTouch {
                column: *column,
                kind: ColumnChangeKind::Reorder,
            })),
            _ => {}
        }
    }
    touches
}

/// What changed for a table that only an op elsewhere versioned: its column
/// bound to a shared property whose options changed, or the relation into
/// it that went.
fn related_touches(writes: &Writes, before: &Before, table: TableId) -> Vec<ColumnTouch> {
    let mut touches = Vec::new();
    for write in &writes.writes {
        match write {
            Write::AddOptions {
                tables,
                definition_id,
                ..
            }
            | Write::UpdateOption {
                tables,
                definition_id,
                ..
            }
            | Write::DeleteOption {
                tables,
                definition_id,
                ..
            } if tables.contains(&table) => {
                if let Some(column) = before.schema.column_for(table, *definition_id) {
                    touches.push(ColumnTouch {
                        column: column.id,
                        kind: ColumnChangeKind::Related,
                    });
                }
            }
            Write::DeleteColumn {
                column_id,
                related: Some((_, related)),
                ..
            } if *related == table => {
                touches.push(ColumnTouch {
                    column: *column_id,
                    kind: ColumnChangeKind::Related,
                });
            }
            _ => {}
        }
    }
    touches
}
