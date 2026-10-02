//! The fake cell store's write batch, applied straight to the world.

use super::*;
use crate::domain::journal::{Before, RowImage, cell_value, row_cells};
use crate::domain::models::{ChangeId, CommittedChange};
use models_databases::views::LaneKey;

/// A first value settles the columns it landed in, as the cell store does in
/// its transaction.
pub(super) fn settle(world: &mut World, table_id: TableId, definitions: Vec<PropertyDefinitionId>) {
    if definitions.is_empty() {
        return;
    }
    for column in &mut world.columns {
        if column.table_id == table_id && definitions.contains(&column.property_definition_id) {
            column.infer_type = false;
        }
    }
    world.settled.push((table_id, definitions));
}

/// The fake cell store's batch, applied straight to the world; the caller
/// rolls the world back unless everything applied. An option for a missing
/// definition fails the batch, as the foreign key does in Postgres.
pub(super) fn apply_in_world(
    world: &mut World,
    writes: &Writes,
) -> Result<WritesOutcome, FakeError> {
    if let Some(new) = &writes.creates {
        let owner = new.database.owner_id.clone();
        if new.starter {
            if world.starters.contains_key(&owner) {
                return Ok(WritesOutcome::StarterTaken);
            }
            let owns_database = world
                .databases
                .iter()
                .any(|database| database.owner_id == owner);
            world.starters.insert(owner.clone(), None);
            if owns_database {
                return Ok(WritesOutcome::StarterTaken);
            }
            world.starters.insert(owner.clone(), Some(new.database.id));
        }
        world.databases.push(new.database.clone());
        world
            .grants
            .entry(owner)
            .or_default()
            .push((new.database.id, AccessLevel::Owner));
    }
    let created: Vec<TableId> = writes
        .writes
        .iter()
        .filter_map(|write| match write {
            Write::CreateTable { table_id, .. } => Some(*table_id),
            _ => None,
        })
        .collect();
    let database_live = world
        .databases
        .iter()
        .any(|database| database.id == writes.database_id && database.trashed_at.is_none());
    // Like the database lock, this refuses a batch that only creates tables.
    if !database_live || world.table_write_not_found {
        let table = writes
            .writes
            .iter()
            .flat_map(|write| write.versioned_tables().iter().copied())
            .chain(created.iter().copied())
            .next()
            .unwrap_or_default();
        return Ok(WritesOutcome::TableNotFound(table));
    }
    for table_id in writes
        .writes
        .iter()
        .flat_map(|write| write.versioned_tables().iter().copied())
        .filter(|table| !created.contains(table))
    {
        let live = world
            .tables
            .iter()
            .any(|table| table.id == table_id && table.database_id == writes.database_id);
        if !live {
            return Ok(WritesOutcome::TableNotFound(table_id));
        }
    }
    let read_versions = writes.writes.iter().filter_map(|write| match write {
        Write::ReplaceColumn {
            table_id,
            read_version: Some(version),
            ..
        } => Some((*table_id, *version)),
        _ => None,
    });
    for (table_id, version) in writes
        .expected_versions
        .iter()
        .copied()
        .chain(read_versions)
    {
        let current = world
            .tables
            .iter()
            .find(|table| table.id == table_id)
            .map(|table| table.version);
        if current != Some(version) {
            return Ok(WritesOutcome::VersionConflict(table_id));
        }
    }
    for (table_id, version) in writes.journal.read_versions() {
        let current = world
            .tables
            .iter()
            .find(|table| table.id == table_id)
            .map(|table| table.version);
        if current.is_some_and(|current| current != version) {
            return Ok(WritesOutcome::SchemaMoved(table_id));
        }
    }
    let before = before_image(world, writes);
    for (index, write) in writes.writes.iter().enumerate() {
        let options: &[(OptionId, PropertyOptionValue)] = match write {
            Write::AddOptions { options, .. } => options,
            Write::CreateColumn {
                definition: Some(definition),
                ..
            } => &definition.options,
            _ => &[],
        };
        for (id, _) in options {
            let taken = world.definitions.values().any(|definition| {
                definition
                    .property_options
                    .iter()
                    .any(|option| option.id == id.into_uuid())
            });
            if taken {
                return Ok(WritesOutcome::IdTaken {
                    write: index,
                    id: TakenId::Option(*id),
                });
            }
        }
    }
    let mut inserted = Vec::new();
    let mut deleted: Vec<TableId> = Vec::new();
    for (index, write) in writes.writes.iter().enumerate() {
        match write {
            Write::Unchanged { .. } => inserted.push(Vec::new()),
            Write::CreateTable { table_id, name } => {
                if world.tables.iter().any(|table| table.id == *table_id) {
                    return Ok(WritesOutcome::IdTaken {
                        write: index,
                        id: TakenId::Table(*table_id),
                    });
                }
                let siblings = world
                    .tables
                    .iter()
                    .filter(|table| table.database_id == writes.database_id);
                if siblings.clone().any(|table| same_name(&table.name, name)) {
                    return Ok(WritesOutcome::TableNameTaken { write: index });
                }
                let last = siblings.map(|table| &table.position).max();
                let position = key_between(last, None).unwrap();
                world.tables.push(Table {
                    id: *table_id,
                    database_id: writes.database_id,
                    name: name.clone(),
                    position,
                    version: TableVersion(0),
                });
                inserted.push(Vec::new());
            }
            Write::RenameTable {
                table_id,
                from,
                name,
            } => {
                let taken = world.tables.iter().any(|table| {
                    table.database_id == writes.database_id
                        && table.id != *table_id
                        && same_name(&table.name, name)
                });
                let Some(table) = world
                    .tables
                    .iter_mut()
                    .find(|table| table.id == *table_id && table.name == *from)
                else {
                    return Ok(WritesOutcome::TableRenamedElsewhere { write: index });
                };
                if taken {
                    return Ok(WritesOutcome::TableRenamedElsewhere { write: index });
                }
                table.name = name.clone();
                inserted.push(Vec::new());
            }
            Write::DeleteTable { table_id, .. } => {
                let siblings = world
                    .tables
                    .iter()
                    .filter(|table| table.database_id == writes.database_id)
                    .count();
                if !world.tables.iter().any(|table| table.id == *table_id) {
                    return Ok(WritesOutcome::TableNotFound(*table_id));
                }
                if siblings <= 1 {
                    return Ok(WritesOutcome::LastTable { write: index });
                }
                world.tables.retain(|table| table.id != *table_id);
                world.columns.retain(|column| column.table_id != *table_id);
                world.views.retain(|view| view.table_id != *table_id);
                // The schema's cleanup triggers take the rows' cells with them.
                for row in world.rows.remove(table_id).unwrap_or_default() {
                    world.cells.remove(&row.id);
                }
                deleted.push(*table_id);
                inserted.push(Vec::new());
            }
            Write::OrderTables { tables, positions } => {
                let mut current: Vec<TableId> = world
                    .tables
                    .iter()
                    .filter(|table| table.database_id == writes.database_id)
                    .map(|table| table.id)
                    .collect();
                let mut requested = tables.clone();
                current.sort();
                requested.sort();
                if current != requested {
                    return Ok(WritesOutcome::TablesChanged { write: index });
                }
                for (id, position) in tables.iter().zip(positions) {
                    if let Some(table) = world.tables.iter_mut().find(|table| table.id == *id) {
                        table.position = position.clone();
                    }
                }
                world
                    .tables
                    .sort_by(|left, right| left.position.cmp(&right.position));
                inserted.push(Vec::new());
            }
            Write::CreateColumn { column, definition } => {
                if world.columns.iter().any(|stored| stored.id == column.id) {
                    return Ok(WritesOutcome::IdTaken {
                        write: index,
                        id: TakenId::Column(column.id),
                    });
                }
                if world.columns.iter().any(|stored| {
                    stored.table_id == column.table_id
                        && stored.property_definition_id == column.property_definition_id
                }) {
                    return Ok(WritesOutcome::MissingColumn { write: index });
                }
                if let Some(definition) = definition {
                    store_definition(world, writes.database_id, definition);
                }
                world.columns.push(column.clone());
                inserted.push(Vec::new());
            }
            Write::RenameColumn {
                table_id,
                column_id,
                from,
                name,
            } => {
                let Some(column) = world.columns.iter_mut().find(|column| {
                    column.id == *column_id
                        && column.table_id == *table_id
                        && column.display_name == *from
                }) else {
                    return Ok(WritesOutcome::ColumnRenamedElsewhere { write: index });
                };
                column.display_name = Some(name.clone());
                inserted.push(Vec::new());
            }
            Write::DeleteColumn {
                table_id,
                column_id,
                definition_id,
                views,
                ..
            } => {
                let Some(position) = world.columns.iter().position(|column| {
                    column.id == *column_id
                        && column.table_id == *table_id
                        && column.property_definition_id == *definition_id
                }) else {
                    return Ok(WritesOutcome::MissingColumn { write: index });
                };
                if !rewrite_views(world, views) {
                    return Ok(WritesOutcome::MissingView { write: index });
                }
                world.columns.remove(position);
                drop_column_cells(world, *table_id, *definition_id);
                inserted.push(Vec::new());
            }
            Write::OrderColumns {
                table_id,
                positions,
            } => {
                for (id, position) in positions {
                    let Some(column) = world
                        .columns
                        .iter_mut()
                        .find(|column| column.id == *id && column.table_id == *table_id)
                    else {
                        return Ok(WritesOutcome::MissingColumn { write: index });
                    };
                    column.position = position.clone();
                }
                inserted.push(Vec::new());
            }
            Write::ReplaceColumn {
                table_id,
                definition,
                replacement,
                views,
                ..
            } => {
                let Some(position) = world.columns.iter().position(|column| {
                    column.id == replacement.column.id
                        && column.table_id == *table_id
                        && column.property_definition_id
                            == replacement.column.property_definition_id
                }) else {
                    return Ok(WritesOutcome::MissingColumn { write: index });
                };
                if !rewrite_views(world, views) {
                    return Ok(WritesOutcome::MissingView { write: index });
                }
                if let Some(definition) = definition {
                    store_definition(world, writes.database_id, definition);
                }
                drop_column_cells(world, *table_id, replacement.column.property_definition_id);
                for (row, value) in &replacement.values {
                    world
                        .cells
                        .entry(*row)
                        .or_default()
                        .insert(replacement.definition_id, value.clone());
                }
                let column = &mut world.columns[position];
                column.property_definition_id = replacement.definition_id;
                column.config = replacement.config.clone();
                column.infer_type = false;
                inserted.push(Vec::new());
            }
            Write::AddOptions {
                definition_id,
                options,
                ..
            } => {
                let definition = world.definitions.get_mut(definition_id).ok_or(FakeError)?;
                for (id, value) in options {
                    let display_order = definition
                        .property_options
                        .iter()
                        .map(|existing| existing.display_order)
                        .max()
                        .map_or(0, |highest| highest + 1);
                    definition.property_options.push(PropertyOption {
                        id: id.into_uuid(),
                        property_definition_id: *definition_id,
                        display_order,
                        value: value.clone(),
                        color: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                    });
                }
                inserted.push(Vec::new());
            }
            Write::InsertRows {
                table_id,
                rows,
                restored,
            } => {
                let mut ids = Vec::new();
                for (row, cells) in rows.iter().enumerate() {
                    let table_rows = world.rows.entry(*table_id).or_default();
                    let (id, position) = match restored.get(row) {
                        Some(restored) => (restored.id, restored.position.clone()),
                        None => (
                            RowId::from_uuid(Uuid::now_v7()),
                            key_between(table_rows.last().map(|last| &last.position), None)
                                .unwrap(),
                        ),
                    };
                    if table_rows.iter().any(|stored| stored.id == id) {
                        return Ok(WritesOutcome::RowTaken {
                            write: index,
                            row: id,
                        });
                    }
                    table_rows.push(RowRef { id, position });
                    table_rows.sort_by(|left, right| left.position.cmp(&right.position));
                    ids.push(id);
                    if !cells.is_empty() {
                        world
                            .cells
                            .entry(id)
                            .or_default()
                            .extend(cells.iter().cloned());
                    }
                    let valued: Vec<_> = cells.iter().map(|(definition, _)| *definition).collect();
                    settle(world, *table_id, valued);
                }
                inserted.push(ids);
            }
            Write::UpdateRows { table_id, rows } => {
                for (row, cells) in rows {
                    let owned = world
                        .rows
                        .get(table_id)
                        .is_some_and(|rows| rows.iter().any(|stored| stored.id == *row));
                    if !owned {
                        return Ok(WritesOutcome::MissingRow {
                            write: index,
                            row: *row,
                        });
                    }
                    let stored = world.cells.entry(*row).or_default();
                    for (definition, value) in cells {
                        match value {
                            Some(value) => {
                                stored.insert(*definition, value.clone());
                            }
                            None => {
                                stored.remove(definition);
                            }
                        }
                    }
                    let valued: Vec<_> = cells
                        .iter()
                        .filter(|(_, value)| value.is_some())
                        .map(|(definition, _)| *definition)
                        .collect();
                    settle(world, *table_id, valued);
                }
                inserted.push(Vec::new());
            }
            Write::DeleteRows {
                table_id,
                rows,
                only_if_unreferenced,
            } => {
                if *only_if_unreferenced
                    && world.cells.iter().any(|(row, cells)| {
                        !rows.contains(row)
                            && cells.values().any(|value| {
                                matches!(value,
                        PropertyValue::EntityRef(references) if references.iter().any(|reference|
                            reference.entity_type == models_properties::EntityType::DatabaseRow
                            && rows.iter().any(|row| row.to_string() == reference.entity_id)))
                            })
                    })
                {
                    return Ok(WritesOutcome::RowInUse);
                }
                for row in rows {
                    let table_rows = world.rows.entry(*table_id).or_default();
                    let Some(position) = table_rows.iter().position(|stored| stored.id == *row)
                    else {
                        return Ok(WritesOutcome::MissingRow {
                            write: index,
                            row: *row,
                        });
                    };
                    table_rows.remove(position);
                    world.cells.remove(row);
                }
                inserted.push(Vec::new());
            }
            Write::UpdateOption {
                definition_id,
                option_id,
                value,
                color,
                ..
            } => {
                let Some(option) =
                    world
                        .definitions
                        .get_mut(definition_id)
                        .and_then(|definition| {
                            definition
                                .property_options
                                .iter_mut()
                                .find(|option| option.id == option_id.into_uuid())
                        })
                else {
                    return Ok(WritesOutcome::MissingOption { write: index });
                };
                if let Some(value) = value {
                    option.value = value.clone();
                }
                if let Some(color) = color {
                    option.color.clone_from(color);
                }
                inserted.push(Vec::new());
            }
            Write::DeleteOption {
                only_if_unused,
                tables,
                definition_id,
                option_id,
                views,
                ..
            } => {
                if *only_if_unused && world.cells.values().any(|cells| {
                    matches!(cells.get(definition_id), Some(PropertyValue::SelectOption(options)) if options.contains(option_id.as_uuid()))
                }) {
                    return Ok(WritesOutcome::OptionInUse);
                }
                if !rewrite_views(world, views) {
                    return Ok(WritesOutcome::MissingView { write: index });
                }
                let boards: Vec<ViewId> = world
                    .views
                    .iter()
                    .filter(|view| tables.contains(&view.table_id))
                    .map(|view| view.id)
                    .collect();
                for board in boards {
                    if let Some(placed) = world.positions.get_mut(&board) {
                        placed.retain(|card| card.lane != LaneKey::Option(*option_id));
                    }
                }
                let Some(definition) = world.definitions.get_mut(definition_id) else {
                    return Ok(WritesOutcome::MissingOption { write: index });
                };
                let before = definition.property_options.len();
                definition
                    .property_options
                    .retain(|option| option.id != option_id.into_uuid());
                if definition.property_options.len() == before {
                    return Ok(WritesOutcome::MissingOption { write: index });
                }
                for cells in world.cells.values_mut() {
                    if let Some(PropertyValue::SelectOption(options)) = cells.get_mut(definition_id)
                    {
                        options.retain(|option| *option != option_id.into_uuid());
                        if options.is_empty() {
                            cells.remove(definition_id);
                        }
                    }
                }
                inserted.push(Vec::new());
            }
            Write::CreateView { view } => {
                if world.views.iter().any(|stored| stored.id == view.id) {
                    return Ok(WritesOutcome::IdTaken {
                        write: index,
                        id: TakenId::View(view.id),
                    });
                }
                if world.views.iter().any(|other| {
                    other.table_id == view.table_id && other.name.eq_ignore_ascii_case(&view.name)
                }) {
                    return Ok(WritesOutcome::ViewNameTaken { write: index });
                }
                world.views.push(view.clone());
                inserted.push(Vec::new());
            }
            Write::UpdateView { view, regrouped } => {
                if !rewrite_views(world, std::slice::from_ref(view)) {
                    return Ok(WritesOutcome::MissingView { write: index });
                }
                if *regrouped {
                    world.positions.remove(&view.id);
                }
                inserted.push(Vec::new());
            }
            Write::DeleteView { table_id, view_id } => {
                let before = world.views.len();
                world
                    .views
                    .retain(|view| !(view.id == *view_id && view.table_id == *table_id));
                if world.views.len() == before {
                    return Ok(WritesOutcome::MissingView { write: index });
                }
                world.positions.remove(view_id);
                inserted.push(Vec::new());
            }
            Write::OrderViews {
                table_id,
                positions,
            } => {
                for placed in positions {
                    let Some(view) = world
                        .views
                        .iter_mut()
                        .find(|view| view.id == placed.view && view.table_id == *table_id)
                    else {
                        return Ok(WritesOutcome::MissingView { write: index });
                    };
                    view.position = placed.position.clone();
                }
                inserted.push(Vec::new());
            }
            Write::MoveCard {
                table_id,
                view_id,
                row,
                positions,
                cell: (definition, value),
            } => {
                let owned = world
                    .rows
                    .get(table_id)
                    .is_some_and(|rows| rows.iter().any(|stored| stored.id == *row));
                if !owned {
                    return Ok(WritesOutcome::MissingRow {
                        write: index,
                        row: *row,
                    });
                }
                let stored = world.cells.entry(*row).or_default();
                match value {
                    Some(value) => {
                        stored.insert(*definition, value.clone());
                    }
                    None => {
                        stored.remove(definition);
                    }
                }
                let placed = world.positions.entry(*view_id).or_default();
                for position in positions {
                    placed.retain(|card| card.row != position.row);
                    placed.push(position.clone());
                }
                inserted.push(Vec::new());
            }
        }
    }
    for (table_id, row) in &writes.related_rows {
        if !world
            .rows
            .get(table_id)
            .is_some_and(|rows| rows.iter().any(|stored| stored.id == *row))
        {
            return Ok(WritesOutcome::MissingRelatedRow(*row));
        }
    }
    let related = writes.writes.iter().filter_map(|write| match write {
        Write::DeleteColumn {
            related: Some((_, table)),
            ..
        } => Some(*table),
        _ => None,
    });
    let mut changed: Vec<TableId> = writes
        .writes
        .iter()
        .filter(|write| write.changes())
        .flat_map(|write| write.versioned_tables().iter().copied())
        .chain(created.iter().copied())
        .chain(related)
        .filter(|table| !deleted.contains(table))
        .collect();
    changed.sort();
    changed.dedup();
    let mut table_versions = HashMap::new();
    for table_id in changed {
        let Some(table) = world.tables.iter_mut().find(|table| table.id == table_id) else {
            continue;
        };
        table.version.0 += 1;
        table_versions.insert(table_id, table.version);
    }
    let entries = crate::domain::journal::entries(writes, &before, &inserted, &table_versions);
    let mut changes = Vec::new();
    for entry in entries {
        let id = ChangeId(i64::try_from(world.journal.len()).unwrap() + 1);
        changes.push(CommittedChange {
            table: entry.table,
            version: entry.version,
            change: id,
        });
        world.journal.push(JournaledChange {
            id,
            actor: writes.created_by.to_string(),
            entry,
        });
    }
    Ok(WritesOutcome::Applied {
        inserted,
        table_versions,
        changes,
    })
}

/// The batch's before-image, read from the world as the cell store reads it
/// under its locks.
fn before_image(world: &World, writes: &Writes) -> Before {
    let reads = crate::domain::journal::reads(writes);
    let schema = &writes.journal.schema;
    let mut before = Before {
        schema: schema.clone(),
        ..Before::default()
    };
    for row in &reads.rows {
        let Some((table, stored)) = world.rows.iter().find_map(|(table, rows)| {
            rows.iter()
                .find(|stored| stored.id == *row)
                .map(|stored| (*table, stored))
        }) else {
            continue;
        };
        let cells = world.cells.get(row).cloned().unwrap_or_default();
        before.rows.insert(
            *row,
            RowImage {
                table,
                position: stored.position.clone(),
                cells: row_cells(schema, table, &cells),
            },
        );
    }
    for (table, column, definition) in &reads.columns {
        let cells = world
            .rows
            .get(table)
            .into_iter()
            .flatten()
            .filter_map(|row| {
                let value = world.cells.get(&row.id)?.get(definition)?;
                Some((row.id, cell_value(value)?))
            })
            .collect();
        before.column_cells.insert(*column, cells);
    }
    for board in &reads.boards {
        before.cards.insert(
            *board,
            world.positions.get(board).cloned().unwrap_or_default(),
        );
    }
    before
}

/// Store a definition a write creates, as the properties system would.
fn store_definition(world: &mut World, database_id: DatabaseId, definition: &NewDefinition) {
    let mut stored = super::super::definition(
        &definition.name,
        definition.data_type,
        definition.is_multi_select,
        PropertyOwner::Database {
            database_id: database_id.into_uuid(),
        },
    );
    stored.definition.id = definition.id;
    stored.definition.specific_entity_type = definition.specific_entity_type;
    stored.property_options = definition
        .options
        .iter()
        .enumerate()
        .map(|(position, (id, value))| PropertyOption {
            id: id.into_uuid(),
            property_definition_id: definition.id,
            display_order: i32::try_from(position).unwrap(),
            value: value.clone(),
            color: Some(TagColor::for_position(position).hex().to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
        .collect();
    world.definitions.insert(definition.id, stored);
}

/// The cells a column's placement held on its table's rows, gone with it as
/// the schema's trigger takes them.
fn drop_column_cells(world: &mut World, table_id: TableId, definition_id: PropertyDefinitionId) {
    let rows: Vec<RowId> = world
        .rows
        .get(&table_id)
        .map(|rows| rows.iter().map(|row| row.id).collect())
        .unwrap_or_default();
    for row in rows {
        if let Some(cells) = world.cells.get_mut(&row) {
            cells.remove(&definition_id);
        }
    }
}
