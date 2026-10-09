//! In-memory fakes for every port, over one shared world the tests inspect.

mod apply_writes;

use models_databases::position::key_between;
use properties::TagColor;

use super::*;
use apply_writes::apply_in_world;

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
pub(super) struct FakeError;

/// Shared mutable world the fakes read and write.
#[derive(Default)]
pub(super) struct World {
    pub(super) databases: Vec<Database>,
    pub(super) tables: Vec<Table>,
    pub(super) columns: Vec<Column>,
    pub(super) definitions: HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions>,
    /// Row identities per table, in position order.
    pub(super) rows: HashMap<TableId, Vec<RowRef>>,
    /// The cell store: a row's cells keyed by definition.
    pub(super) cells: HashMap<RowId, HashMap<Uuid, PropertyValue>>,
    pub(super) grants: HashMap<String, Vec<(DatabaseId, AccessLevel)>>,
    pub(super) published: Vec<(TableId, TableVersion)>,
    pub(super) metadata_changes: Vec<DatabaseId>,
    /// Every awareness relay the service asked for.
    pub(super) awareness: Vec<(DatabaseId, String, Awareness)>,
    /// Simulate the gateway refusing an awareness relay.
    pub(super) awareness_relay_fails: bool,
    pub(super) share_updates: Vec<Vec<models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission>>,
    /// Every `macro.databases` envelope the service handed the broker.
    pub(super) broker_events: Vec<serde_json::Value>,
    /// Every `settle_inference` call, newest last.
    pub(super) settled: Vec<(TableId, Vec<PropertyDefinitionId>)>,
    /// Simulate a parent removed between domain validation and the write.
    pub(super) table_write_not_found: bool,
    /// Saved queries, oldest first.
    pub(super) queries: Vec<SavedQuery>,
    /// How many write batches the cell store was handed.
    pub(super) write_batches: usize,
    /// The shared definitions each user may change, as the properties system
    /// answers it.
    pub(super) editable_definitions: HashMap<String, Vec<PropertyDefinitionId>>,
    /// Every table's views.
    pub(super) views: Vec<DatabaseView>,
    /// Where each board's cards sit.
    pub(super) positions: HashMap<ViewId, Vec<CardPosition>>,
    /// The change journal, oldest first.
    pub(super) journal: Vec<JournaledChange>,
}

/// One change the fake cell store journaled.
#[derive(Debug, Clone)]
pub(super) struct JournaledChange {
    pub(super) id: crate::domain::models::ChangeId,
    pub(super) actor: String,
    pub(super) entry: crate::domain::journal::JournalEntry,
}

/// Store views a schema change rewrote; `false` when one is gone.
pub(super) fn rewrite_views(world: &mut World, views: &[DatabaseView]) -> bool {
    for view in views {
        let Some(stored) = world.views.iter_mut().find(|stored| stored.id == view.id) else {
            return false;
        };
        *stored = view.clone();
    }
    true
}

pub(super) type Shared = Arc<Mutex<World>>;

#[derive(Clone)]
pub(super) struct FakeRepo(pub(super) Shared);
#[derive(Clone)]
pub(super) struct FakeDefinitions(pub(super) Shared);
#[derive(Clone)]
pub(super) struct FakeCells(pub(super) Shared);
#[derive(Clone)]
pub(super) struct FakeEvents(pub(super) Shared);
#[derive(Clone)]
pub(super) struct FakeAccess(pub(super) Shared);

impl DatabasesRepo for FakeRepo {
    type Error = FakeError;
    async fn create_database(
        &self,
        command: &CreateDatabase,
        first_table: FirstTable,
    ) -> Result<Database, FakeError> {
        let database = Database {
            id: DatabaseId::new(),
            name: command.name.clone(),
            owner_id: command.owner_id.as_ref().to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        };
        let title = definition(
            first_table.title_column,
            DataType::String,
            false,
            PropertyOwner::Database {
                database_id: database.id.into_uuid(),
            },
        );
        let table = Table {
            id: TableId::new(),
            database_id: database.id,
            name: first_table.name.to_string(),
            position: key_between(None, None).unwrap(),
            version: TableVersion(0),
        };
        let mut world = self.0.lock().unwrap();
        world.databases.push(database.clone());
        world.columns.push(Column {
            protections: vec![],
            nullable: true,
            id: ColumnId::new(),
            table_id: table.id,
            property_definition_id: title.definition.id,
            display_name: None,
            position: key_between(None, None).unwrap(),
            infer_type: true,
            config: None,
        });
        world.definitions.insert(title.definition.id, title);
        world.tables.push(table);
        world
            .grants
            .entry(command.owner_id.as_ref().to_string())
            .or_default()
            .push((database.id, AccessLevel::Owner));
        Ok(database)
    }
    async fn get_database(
        &self,
        id: DatabaseId,
    ) -> Result<Option<(Database, Vec<Table>)>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .databases
            .iter()
            .find(|database| database.id == id)
            .map(|database| {
                (
                    database.clone(),
                    world
                        .tables
                        .iter()
                        .filter(|table| table.database_id == id)
                        .cloned()
                        .collect(),
                )
            }))
    }
    async fn rename_database(&self, id: DatabaseId, name: &str) -> Result<bool, FakeError> {
        let mut world = self.0.lock().unwrap();
        if let Some(database) = world
            .databases
            .iter_mut()
            .find(|database| database.id == id)
        {
            database.name = name.to_string();
            Ok(true)
        } else {
            Ok(false)
        }
    }
    async fn trash_database(
        &self,
        id: DatabaseId,
        trashed_at: chrono::DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        let mut world = self.0.lock().unwrap();
        if let Some(database) = world
            .databases
            .iter_mut()
            .find(|database| database.id == id)
        {
            database.trashed_at = Some(trashed_at);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    async fn restore_database(&self, id: DatabaseId) -> Result<bool, FakeError> {
        let mut world = self.0.lock().unwrap();
        if let Some(database) = world
            .databases
            .iter_mut()
            .find(|database| database.id == id)
        {
            database.trashed_at = None;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    async fn delete_database(&self, id: DatabaseId) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        world.databases.retain(|database| database.id != id);
        let table_ids: Vec<TableId> = world
            .tables
            .iter()
            .filter(|table| table.database_id == id)
            .map(|table| table.id)
            .collect();
        world.tables.retain(|table| table.database_id != id);
        world
            .columns
            .retain(|column| !table_ids.contains(&column.table_id));
        let row_ids: Vec<RowId> = table_ids
            .iter()
            .filter_map(|table_id| world.rows.remove(table_id))
            .flatten()
            .map(|row| row.id)
            .collect();
        world.cells.retain(|row_id, _| !row_ids.contains(row_id));
        // The Postgres adapter purges `entity_access` rows in the same
        // transaction; the fake's grant map stands in for that table.
        for grants in world.grants.values_mut() {
            grants.retain(|(database_id, _)| *database_id != id);
        }
        Ok(())
    }
    async fn infer_column_type(
        &self,
        table: &Table,
        column: &Column,
        definition_id: PropertyDefinitionId,
        _actor: &crate::domain::journal::JournalActor,
    ) -> Result<Option<TableVersion>, FakeError> {
        let mut world = self.0.lock().unwrap();
        let has_value = world.rows.get(&table.id).is_some_and(|rows| {
            rows.iter().any(|row| {
                world
                    .cells
                    .get(&row.id)
                    .is_some_and(|cells| cells.contains_key(&column.property_definition_id))
            })
        });
        if has_value {
            return Ok(None);
        }
        let Some(table_index) = world
            .tables
            .iter()
            .position(|stored| stored.id == table.id && stored.version == table.version)
        else {
            return Ok(None);
        };
        let Some(column_index) = world.columns.iter().position(|stored| {
            stored.id == column.id
                && stored.table_id == table.id
                && stored.property_definition_id == column.property_definition_id
                && stored.infer_type
        }) else {
            return Ok(None);
        };
        world.columns[column_index].property_definition_id = definition_id;
        world.columns[column_index].infer_type = false;
        world.tables[table_index].version.0 += 1;
        Ok(Some(world.tables[table_index].version))
    }
    async fn row_refs(&self, table_id: TableId) -> Result<Vec<RowRef>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .rows
            .get(&table_id)
            .cloned()
            .unwrap_or_default())
    }
    async fn table_versions(
        &self,
        table_ids: &[TableId],
    ) -> Result<HashMap<TableId, TableVersion>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .tables
            .iter()
            .filter(|table| table_ids.contains(&table.id))
            .map(|table| (table.id, table.version))
            .collect())
    }
    async fn databases_by_ids(&self, ids: &[DatabaseId]) -> Result<Vec<Database>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .databases
            .iter()
            .filter(|database| ids.contains(&database.id))
            .cloned()
            .collect())
    }
    async fn tables_for_databases(
        &self,
        database_ids: &[DatabaseId],
    ) -> Result<Vec<Table>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .tables
            .iter()
            .filter(|table| database_ids.contains(&table.database_id))
            .cloned()
            .collect())
    }
    async fn columns_for_tables(&self, table_ids: &[TableId]) -> Result<Vec<Column>, FakeError> {
        let mut columns: Vec<Column> = self
            .0
            .lock()
            .unwrap()
            .columns
            .iter()
            .filter(|column| table_ids.contains(&column.table_id))
            .cloned()
            .collect();
        columns.sort_by(|left, right| {
            (left.table_id, &left.position).cmp(&(right.table_id, &right.position))
        });
        Ok(columns)
    }
    async fn views_for_tables(
        &self,
        table_ids: &[TableId],
    ) -> Result<Vec<DatabaseView>, FakeError> {
        let mut views: Vec<DatabaseView> = self
            .0
            .lock()
            .unwrap()
            .views
            .iter()
            .filter(|view| table_ids.contains(&view.table_id))
            .cloned()
            .collect();
        views.sort_by(|left, right| {
            (left.table_id, &left.position).cmp(&(right.table_id, &right.position))
        });
        Ok(views)
    }
    async fn view_positions(&self, view_id: ViewId) -> Result<Vec<CardPosition>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .positions
            .get(&view_id)
            .cloned()
            .unwrap_or_default())
    }
    async fn save_query(
        &self,
        database_id: Option<DatabaseId>,
        definition: &QueryDefinition,
        created_by: &MacroUserIdStr<'_>,
    ) -> Result<SavedQuery, FakeError> {
        let saved = SavedQuery {
            id: QueryId::new(),
            definition: definition.clone(),
            database_id,
            created_by: Some(created_by.as_ref().to_string()),
            created_at: Utc::now(),
        };
        self.0.lock().unwrap().queries.push(saved.clone());
        Ok(saved)
    }
    async fn change(
        &self,
        database_id: DatabaseId,
        change: crate::domain::models::ChangeId,
    ) -> Result<Option<crate::domain::journal::ChangeRecord>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .journal
            .iter()
            .find(|journaled| journaled.id == change && journaled.entry.database_id == database_id)
            .map(Self::record))
    }

    async fn changes_after(
        &self,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<Vec<crate::domain::journal::ChangeRecord>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .journal
            .iter()
            .filter(|journaled| {
                journaled.entry.table == table_id && journaled.entry.version > version
            })
            .map(Self::record)
            .collect())
    }

    async fn touches_after(
        &self,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<Vec<crate::domain::journal::VersionTouches>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .journal
            .iter()
            .filter(|journaled| {
                journaled.entry.table == table_id && journaled.entry.version > version
            })
            .map(|journaled| crate::domain::journal::VersionTouches {
                version: journaled.entry.version,
                rows: journaled
                    .entry
                    .rows
                    .iter()
                    .map(|touch| (touch.row, touch.kind))
                    .collect(),
                columns: journaled.entry.columns.clone(),
            })
            .collect())
    }

    async fn row_history(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        row_id: RowId,
    ) -> Result<Vec<crate::domain::journal::JournaledRowChange>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(Self::history(&world, database_id, table_id, row_id))
    }

    async fn get_query(&self, id: QueryId) -> Result<Option<SavedQuery>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .queries
            .iter()
            .find(|query| query.id == id)
            .cloned())
    }
}

impl FakeRepo {
    fn record(change: &JournaledChange) -> crate::domain::journal::ChangeRecord {
        crate::domain::journal::ChangeRecord {
            change: crate::domain::journal::StoredChange {
                id: change.id,
                table: change.entry.table,
                version: change.entry.version,
                actor: Some(change.actor.clone()),
                acting_bot: None,
                at: chrono::DateTime::UNIX_EPOCH,
                ops: change.entry.ops.clone(),
                inverse: change.entry.inverse.clone(),
            },
            rows: change.entry.rows.clone(),
            columns: change.entry.columns.clone(),
        }
    }

    fn history(
        world: &World,
        database_id: DatabaseId,
        table_id: TableId,
        row_id: RowId,
    ) -> Vec<crate::domain::journal::JournaledRowChange> {
        world
            .journal
            .iter()
            .rev()
            .filter(|change| {
                change.entry.database_id == database_id && change.entry.table == table_id
            })
            .filter_map(|change| {
                let touch = change.entry.rows.iter().find(|touch| touch.row == row_id)?;
                Some(crate::domain::journal::JournaledRowChange {
                    change: crate::domain::journal::StoredChange {
                        id: change.id,
                        table: change.entry.table,
                        version: change.entry.version,
                        actor: Some(change.actor.clone()),
                        acting_bot: None,
                        at: chrono::DateTime::UNIX_EPOCH,
                        ops: change.entry.ops.clone(),
                        inverse: change.entry.inverse.clone(),
                    },
                    kind: touch.kind,
                    columns: touch.columns.clone(),
                })
            })
            .collect()
    }
}

impl CellStore for FakeCells {
    type Error = FakeError;
    async fn cells(
        &self,
        rows: &[RowId],
    ) -> Result<HashMap<RowId, HashMap<PropertyDefinitionId, PropertyValue>>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(rows
            .iter()
            .filter_map(|row| world.cells.get(row).map(|cells| (*row, cells.clone())))
            .collect())
    }
    async fn column_cells(
        &self,
        rows: &[RowId],
        definition: PropertyDefinitionId,
    ) -> Result<HashMap<RowId, PropertyValue>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(rows
            .iter()
            .filter_map(|row| {
                let value = world.cells.get(row)?.get(&definition)?;
                Some((*row, value.clone()))
            })
            .collect())
    }
    async fn apply_writes(&self, writes: &Writes) -> Result<WritesOutcome, FakeError> {
        let mut world = self.0.lock().unwrap();
        world.write_batches += 1;
        let before = (
            world.tables.clone(),
            world.columns.clone(),
            world.definitions.clone(),
            world.rows.clone(),
            world.cells.clone(),
            world.settled.clone(),
            world.views.clone(),
            world.positions.clone(),
        );
        let outcome = apply_in_world(&mut world, writes);
        if !matches!(outcome, Ok(WritesOutcome::Applied { .. })) {
            (
                world.tables,
                world.columns,
                world.definitions,
                world.rows,
                world.cells,
                world.settled,
                world.views,
                world.positions,
            ) = before;
        }
        outcome
    }
}

impl ColumnDefinitionStore for FakeDefinitions {
    type Error = FakeError;
    async fn bindable_definition(
        &self,
        _database_id: DatabaseId,
        _viewer: &Viewer,
        id: PropertyDefinitionId,
    ) -> Result<Option<PropertyDefinitionId>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .definitions
            .contains_key(&id)
            .then_some(id))
    }
    async fn create_typed_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: DataType,
        is_multi_select: bool,
        specific_entity_type: Option<PropertyEntityType>,
        options: &[PropertyOptionValue],
    ) -> Result<PropertyDefinitionWithOptions, FakeError> {
        let mut created = definition(
            name,
            data_type,
            is_multi_select,
            PropertyOwner::Database {
                database_id: database_id.into_uuid(),
            },
        );
        created.definition.specific_entity_type = specific_entity_type;
        created.property_options = options
            .iter()
            .enumerate()
            .map(|(position, value)| PropertyOption {
                id: Uuid::new_v4(),
                property_definition_id: created.definition.id,
                display_order: i32::try_from(position).unwrap(),
                value: value.clone(),
                color: Some(TagColor::for_position(position).hex().to_string()),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            })
            .collect();
        self.0
            .lock()
            .unwrap()
            .definitions
            .insert(created.definition.id, created.clone());
        Ok(created)
    }
    async fn delete_unused_definition(&self, id: PropertyDefinitionId) -> Result<(), FakeError> {
        self.0.lock().unwrap().definitions.remove(&id);
        Ok(())
    }
    async fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> Result<Vec<PropertyDefinitionWithOptions>, FakeError> {
        let world = self.0.lock().unwrap();
        Ok(ids
            .iter()
            .filter_map(|id| world.definitions.get(id).cloned())
            .collect())
    }
    async fn editable_definitions(
        &self,
        viewer: &Viewer,
        ids: &[PropertyDefinitionId],
    ) -> Result<Vec<PropertyDefinitionId>, FakeError> {
        let world = self.0.lock().unwrap();
        let editable = world
            .editable_definitions
            .get(viewer.user_id.as_ref())
            .cloned()
            .unwrap_or_default();
        Ok(ids
            .iter()
            .copied()
            .filter(|id| editable.contains(id))
            .collect())
    }
}

impl TableEventPublisher for FakeEvents {
    type Error = FakeError;
    async fn database_changed(&self, database_id: DatabaseId) -> Result<(), FakeError> {
        self.0.lock().unwrap().metadata_changes.push(database_id);
        Ok(())
    }
    async fn table_changed(
        &self,
        _database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<(), FakeError> {
        self.0.lock().unwrap().published.push((table_id, version));
        Ok(())
    }
    async fn awareness(
        &self,
        database_id: DatabaseId,
        user_id: &MacroUserIdStr<'_>,
        state: &Awareness,
    ) -> Result<(), FakeError> {
        let mut world = self.0.lock().unwrap();
        if world.awareness_relay_fails {
            return Err(FakeError);
        }
        world
            .awareness
            .push((database_id, user_id.as_ref().to_string(), state.clone()));
        Ok(())
    }
}

impl AccessDirectory for FakeAccess {
    type Error = FakeError;
    async fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> Result<Vec<(DatabaseId, AccessLevel)>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .grants
            .get(viewer.user_id.as_ref())
            .cloned()
            .unwrap_or_default())
    }
    async fn database_access(
        &self,
        viewer: &Viewer,
        database_id: DatabaseId,
    ) -> Result<Option<AccessLevel>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .grants
            .get(viewer.user_id.as_ref())
            .into_iter()
            .flatten()
            .filter(|(id, _)| *id == database_id)
            .map(|(_, level)| *level)
            .max())
    }
}

#[derive(Clone)]
pub(super) struct RecordingBroker(pub(super) Shared);

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let envelope =
            serde_json::to_value(event.event()).map_err(EventBrokerError::Serialization)?;
        self.0.lock().unwrap().broker_events.push(envelope);
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
