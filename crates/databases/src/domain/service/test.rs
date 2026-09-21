//! Service tests: the real SQLite executor over in-memory fakes for every
//! other port, so the whole exec pipeline (catalog → analyze → materialize →
//! execute → translate → apply) is exercised without Postgres, and every
//! allow/deny decision is asserted at the service boundary.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::PropertyOwner;
use models_properties::shared::{DataType, EntityType as PropertyEntityType};
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    ApplyOutcome, Column, ColumnBinding, ColumnConfig, PropertyDefinitionId, RowChange, SqlValue,
    TableSource, TableVersion,
};
use crate::outbound::rusqlite_executor::{ExecutorLimits, RusqliteExecutor};

mod columns;
mod discovery;
mod infer_column_type;
mod relations;
mod rename_column;
mod sharing;

const OWNER: &str = "macro|owner@macro.com";
const VIEWER: &str = "macro|viewer@macro.com";
const STRANGER: &str = "macro|stranger@macro.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

fn viewer(id: &'static str) -> Viewer {
    Viewer { user_id: user(id) }
}

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeError;

/// Shared mutable world the fakes read and write.
#[derive(Default)]
struct World {
    databases: Vec<Database>,
    tables: Vec<Table>,
    columns: Vec<Column>,
    definitions: HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions>,
    rows: HashMap<TableId, Vec<Row>>,
    links: HashMap<ColumnId, Vec<(RowId, RowId)>>,
    grants: HashMap<String, Vec<(DatabaseId, AccessGrant)>>,
    published: Vec<(TableId, TableVersion)>,
    share_updates: Vec<Vec<models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission>>,
    /// Every `macro.databases` envelope the service handed the broker.
    broker_events: Vec<serde_json::Value>,
    applied: Vec<RowChange>,
    /// Row limits `fetch_rows` was called with, newest last.
    fetch_row_limits: Vec<usize>,
    /// When set, the fake magic table reports itself truncated.
    magic_truncated: bool,
}

type Shared = Arc<Mutex<World>>;

#[derive(Clone)]
struct FakeRepo(Shared);
#[derive(Clone)]
struct FakeDefs(Shared);
#[derive(Clone)]
struct FakeMagic(Shared);
#[derive(Clone)]
struct FakeEvents(Shared);
#[derive(Clone)]
struct FakeAccess(Shared);

impl DatabasesRepo for FakeRepo {
    type Err = FakeError;
    async fn create_database(
        &self,
        cmd: &CreateDatabase,
        starter_table_name: &str,
    ) -> Result<Database, FakeError> {
        let database = Database {
            id: Uuid::new_v4(),
            name: cmd.name.clone(),
            owner_id: cmd.owner_id.as_ref().to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        };
        let mut w = self.0.lock().unwrap();
        w.databases.push(database.clone());
        let position = format!("{:04}", w.tables.len());
        w.tables.push(Table {
            id: Uuid::new_v4(),
            database_id: database.id,
            name: starter_table_name.to_string(),
            position,
            version: TableVersion(0),
        });
        w.grants
            .entry(cmd.owner_id.as_ref().to_string())
            .or_default()
            .push((database.id, AccessGrant::Owner));
        Ok(database)
    }
    async fn get_database(
        &self,
        id: DatabaseId,
    ) -> Result<Option<(Database, Vec<Table>)>, FakeError> {
        let w = self.0.lock().unwrap();
        Ok(w.databases.iter().find(|d| d.id == id).map(|d| {
            (
                d.clone(),
                w.tables
                    .iter()
                    .filter(|t| t.database_id == id)
                    .cloned()
                    .collect(),
            )
        }))
    }
    async fn rename_database(&self, id: DatabaseId, name: &str) -> Result<(), FakeError> {
        let mut w = self.0.lock().unwrap();
        if let Some(database) = w.databases.iter_mut().find(|d| d.id == id) {
            database.name = name.to_string();
        }
        Ok(())
    }
    async fn trash_database(
        &self,
        id: DatabaseId,
        trashed_at: chrono::DateTime<Utc>,
    ) -> Result<(), FakeError> {
        let mut w = self.0.lock().unwrap();
        if let Some(database) = w.databases.iter_mut().find(|d| d.id == id) {
            database.trashed_at = Some(trashed_at);
        }
        Ok(())
    }
    async fn restore_database(&self, id: DatabaseId) -> Result<(), FakeError> {
        let mut w = self.0.lock().unwrap();
        if let Some(database) = w.databases.iter_mut().find(|d| d.id == id) {
            database.trashed_at = None;
        }
        Ok(())
    }
    async fn delete_database(&self, id: DatabaseId) -> Result<(), FakeError> {
        let mut w = self.0.lock().unwrap();
        w.databases.retain(|d| d.id != id);
        let table_ids: Vec<TableId> = w
            .tables
            .iter()
            .filter(|t| t.database_id == id)
            .map(|t| t.id)
            .collect();
        w.tables.retain(|t| t.database_id != id);
        w.columns.retain(|c| !table_ids.contains(&c.table_id));
        w.rows.retain(|table_id, _| !table_ids.contains(table_id));
        // The Postgres adapter purges `entity_access` rows in the same
        // transaction; the fake's grant map stands in for that table.
        for grants in w.grants.values_mut() {
            grants.retain(|(database_id, _)| *database_id != id);
        }
        Ok(())
    }
    async fn create_table(&self, cmd: &CreateTable) -> Result<Option<Table>, FakeError> {
        let mut w = self.0.lock().unwrap();
        if w.tables
            .iter()
            .any(|table| table.database_id == cmd.database_id && same_name(&table.name, &cmd.name))
        {
            return Ok(None);
        }
        let table = Table {
            id: Uuid::new_v4(),
            database_id: cmd.database_id,
            name: cmd.name.clone(),
            position: format!("{:04}", w.tables.len()),
            version: TableVersion(0),
        };
        w.tables.push(table.clone());
        Ok(Some(table))
    }
    async fn rename_table(
        &self,
        table: &Table,
        name: &str,
        previous_name: &str,
    ) -> Result<Option<Table>, FakeError> {
        let mut world = self.0.lock().unwrap();
        let Some(current) = world
            .tables
            .iter_mut()
            .find(|candidate| candidate.id == table.id && candidate.name == previous_name)
        else {
            return Ok(None);
        };
        current.name = name.to_string();
        current.version.0 += 1;
        Ok(Some(current.clone()))
    }
    async fn create_column(
        &self,
        table_id: TableId,
        property_definition_id: PropertyDefinitionId,
        cmd: &CreateColumn,
    ) -> Result<ColumnId, FakeError> {
        let mut w = self.0.lock().unwrap();
        let column = Column {
            infer_type: cmd.infer_type,
            display_name: None,
            id: Uuid::new_v4(),
            table_id,
            property_definition_id,
            position: format!("{:04}", w.columns.len()),
            config: cmd.config.clone(),
        };
        w.columns.push(column.clone());
        Ok(column.id)
    }
    async fn bump_table_version(&self, table_id: TableId) -> Result<TableVersion, FakeError> {
        let mut w = self.0.lock().unwrap();
        let table = w
            .tables
            .iter_mut()
            .find(|t| t.id == table_id)
            .ok_or(FakeError)?;
        table.version = TableVersion(table.version.0 + 1);
        Ok(table.version)
    }
    async fn rename_column(
        &self,
        table: &Table,
        column: &Column,
        name: &str,
    ) -> Result<Option<RenameColumnOutcome>, FakeError> {
        let mut world = self.0.lock().unwrap();
        let Some(table_index) = world
            .tables
            .iter()
            .position(|current| current.id == table.id && current.version == table.version)
        else {
            return Ok(None);
        };
        let Some(column_index) = world.columns.iter().position(|current| {
            current.id == column.id
                && current.table_id == table.id
                && current.display_name == column.display_name
        }) else {
            return Ok(None);
        };
        world.tables[table_index].version.0 += 1;
        world.columns[column_index].display_name = Some(name.to_string());
        Ok(Some(RenameColumnOutcome {
            column: world.columns[column_index].clone(),
            table_version: world.tables[table_index].version,
        }))
    }
    async fn infer_column_type(
        &self,
        table: &Table,
        column: &Column,
        definition_id: PropertyDefinitionId,
    ) -> Result<Option<TableVersion>, FakeError> {
        let mut w = self.0.lock().unwrap();
        if w.rows.get(&table.id).is_some_and(|rows| {
            rows.iter()
                .any(|row| row.cells.contains_key(&column.property_definition_id))
        }) {
            return Ok(None);
        }
        let Some(t) = w
            .tables
            .iter()
            .position(|t| t.id == table.id && t.version == table.version)
        else {
            return Ok(None);
        };
        let Some(c) = w.columns.iter().position(|c| {
            c.id == column.id
                && c.table_id == table.id
                && c.property_definition_id == column.property_definition_id
                && c.infer_type
        }) else {
            return Ok(None);
        };
        w.columns[c].property_definition_id = definition_id;
        w.columns[c].infer_type = false;
        w.tables[t].version.0 += 1;
        Ok(Some(w.tables[t].version))
    }
    async fn replace_column(
        &self,
        table: &Table,
        replacement: &ColumnReplacement,
    ) -> Result<Option<TableVersion>, FakeError> {
        let mut w = self.0.lock().unwrap();
        let Some(t) = w
            .tables
            .iter()
            .position(|t| t.id == table.id && t.version == table.version)
        else {
            return Ok(None);
        };
        let Some(c) = w.columns.iter().position(|c| {
            c.id == replacement.column.id
                && c.table_id == table.id
                && c.property_definition_id == replacement.column.property_definition_id
        }) else {
            return Ok(None);
        };
        w.columns[c].property_definition_id = replacement.definition_id;
        w.columns[c].config = replacement.config.clone();
        w.columns[c].infer_type = false;
        for row in w.rows.entry(table.id).or_default() {
            row.cells.remove(&replacement.column.property_definition_id);
            if let Some((_, value)) = replacement.values.iter().find(|(id, _)| *id == row.id) {
                row.cells.insert(replacement.definition_id, value.clone());
            }
        }
        w.tables[t].version.0 += 1;
        Ok(Some(w.tables[t].version))
    }
    async fn delete_column(
        &self,
        table: &Table,
        column: &Column,
    ) -> Result<Option<ColumnSchemaOutcome>, FakeError> {
        let mut w = self.0.lock().unwrap();
        let Some(t) = w
            .tables
            .iter()
            .position(|t| t.id == table.id && t.version == table.version)
        else {
            return Ok(None);
        };
        let Some(c) = w
            .columns
            .iter()
            .position(|c| c.id == column.id && c.table_id == table.id)
        else {
            return Ok(None);
        };
        w.columns.remove(c);
        w.links.remove(&column.id);
        for row in w.rows.entry(table.id).or_default() {
            row.cells.remove(&column.property_definition_id);
        }
        w.tables[t].version.0 += 1;
        let mut table_versions = HashMap::from([(table.id, w.tables[t].version)]);
        if let Some(ColumnConfig::Link { table_id, .. }) = column.config
            && table_id != table.id
            && let Some(target) = w.tables.iter_mut().find(|t| t.id == table_id)
        {
            target.version.0 += 1;
            table_versions.insert(table_id, target.version);
        }
        Ok(Some(ColumnSchemaOutcome { table_versions }))
    }
    async fn reorder_columns(
        &self,
        table: &Table,
        ids: &[ColumnId],
    ) -> Result<Option<TableVersion>, FakeError> {
        let mut w = self.0.lock().unwrap();
        let Some(t) = w
            .tables
            .iter()
            .position(|t| t.id == table.id && t.version == table.version)
        else {
            return Ok(None);
        };
        for (index, id) in ids.iter().enumerate() {
            let Some(c) = w
                .columns
                .iter_mut()
                .find(|c| c.id == *id && c.table_id == table.id)
            else {
                return Ok(None);
            };
            c.position = format!("{:04}", index + 1);
        }
        w.tables[t].version.0 += 1;
        Ok(Some(w.tables[t].version))
    }
    async fn fetch_rows(&self, table_id: TableId, limit: usize) -> Result<Vec<Row>, FakeError> {
        // Honours `limit` like the real `LIMIT $2`, so the domain's over-cap
        // check is exercised against a truncated read, not a full one.
        let mut world = self.0.lock().unwrap();
        world.fetch_row_limits.push(limit);
        let mut rows = world.rows.get(&table_id).cloned().unwrap_or_default();
        drop(world);
        rows.truncate(limit);
        Ok(rows)
    }
    async fn fetch_links(&self, column_id: ColumnId) -> Result<Vec<(RowId, RowId)>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .links
            .get(&column_id)
            .cloned()
            .unwrap_or_default())
    }
    async fn apply_changes(
        &self,
        _viewer: &Viewer,
        changes: &[RowChange],
        expected_versions: &HashMap<TableId, TableVersion>,
    ) -> Result<ApplyOutcome, FakeError> {
        let mut w = self.0.lock().unwrap();
        for (table_id, expected) in expected_versions {
            if let Some(table) = w.tables.iter().find(|t| t.id == *table_id)
                && table.version != *expected
            {
                return Ok(ApplyOutcome::VersionConflict {
                    table_id: *table_id,
                });
            }
        }
        let mut minted = Vec::new();
        let mut versions = HashMap::new();
        for change in changes {
            for column in &mut w.columns {
                let has_value = match change {
                    RowChange::Insert {
                        table_id, cells, ..
                    } => {
                        *table_id == column.table_id
                            && cells.contains_key(&column.property_definition_id)
                    }
                    RowChange::Update {
                        table_id, cells, ..
                    } => {
                        *table_id == column.table_id
                            && cells
                                .get(&column.property_definition_id)
                                .is_some_and(Option::is_some)
                    }
                    _ => false,
                };
                if has_value {
                    column.infer_type = false;
                }
            }
            w.applied.push(change.clone());
            match change {
                RowChange::Insert {
                    table_id,
                    row_id,
                    cells,
                } => {
                    let id = *row_id;
                    minted.push(id);
                    w.rows.entry(*table_id).or_default().push(Row {
                        id,
                        table_id: *table_id,
                        position: "z".into(),
                        cells: cells
                            .iter()
                            .map(|(k, v)| {
                                (
                                    *k,
                                    models_properties::convert_set_property_value_to_property_value(
                                        v,
                                    ),
                                )
                            })
                            .collect(),
                    });
                    versions.insert(
                        *table_id,
                        TableVersion(
                            w.tables
                                .iter()
                                .find(|t| t.id == *table_id)
                                .map(|t| t.version.0 + 1)
                                .unwrap_or(1),
                        ),
                    );
                }
                RowChange::Update {
                    table_id,
                    row_id,
                    cells,
                } => {
                    let row = w
                        .rows
                        .get_mut(table_id)
                        .and_then(|rows| rows.iter_mut().find(|r| r.id == *row_id))
                        .expect("row exists");
                    for (k, v) in cells {
                        match v {
                            Some(v) => {
                                row.cells.insert(
                                    *k,
                                    models_properties::convert_set_property_value_to_property_value(
                                        v,
                                    ),
                                );
                            }
                            None => {
                                row.cells.remove(k);
                            }
                        }
                    }
                    versions.insert(
                        *table_id,
                        TableVersion(
                            w.tables
                                .iter()
                                .find(|t| t.id == *table_id)
                                .map(|t| t.version.0 + 1)
                                .unwrap_or(1),
                        ),
                    );
                }
                RowChange::Delete { table_id, row_id } => {
                    if let Some(rows) = w.rows.get_mut(table_id) {
                        rows.retain(|r| r.id != *row_id);
                    }
                    versions.insert(
                        *table_id,
                        TableVersion(
                            w.tables
                                .iter()
                                .find(|t| t.id == *table_id)
                                .map(|t| t.version.0 + 1)
                                .unwrap_or(1),
                        ),
                    );
                }
                RowChange::Link {
                    column_id,
                    source_row_id,
                    target_row_id,
                } => {
                    w.links
                        .entry(*column_id)
                        .or_default()
                        .push((*source_row_id, *target_row_id));
                }
                RowChange::Unlink {
                    column_id,
                    source_row_id,
                    target_row_id,
                } => {
                    if let Some(edges) = w.links.get_mut(column_id) {
                        edges.retain(|e| e != &(*source_row_id, *target_row_id));
                    }
                }
            }
        }
        for (table_id, version) in &versions {
            if let Some(table) = w.tables.iter_mut().find(|t| t.id == *table_id) {
                table.version = *version;
            }
        }
        Ok(ApplyOutcome::Applied((minted, versions)))
    }
    async fn table_versions(
        &self,
        table_ids: &[TableId],
    ) -> Result<HashMap<TableId, TableVersion>, FakeError> {
        let w = self.0.lock().unwrap();
        Ok(w.tables
            .iter()
            .filter(|t| table_ids.contains(&t.id))
            .map(|t| (t.id, t.version))
            .collect())
    }
    async fn databases_by_ids(&self, ids: &[DatabaseId]) -> Result<Vec<Database>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .databases
            .iter()
            .filter(|d| ids.contains(&d.id))
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
            .filter(|t| database_ids.contains(&t.database_id))
            .cloned()
            .collect())
    }
    async fn columns_for_tables(&self, table_ids: &[TableId]) -> Result<Vec<Column>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .columns
            .iter()
            .filter(|c| table_ids.contains(&c.table_id))
            .cloned()
            .collect())
    }
}

impl ColumnDefinitionStore for FakeDefs {
    type Err = FakeError;
    async fn resolve_binding(
        &self,
        database_id: DatabaseId,
        _viewer: &Viewer,
        binding: &ColumnBinding,
    ) -> Result<PropertyDefinitionId, FakeError> {
        match binding {
            ColumnBinding::ExistingDefinition(id) => {
                if self.0.lock().unwrap().definitions.contains_key(id) {
                    Ok(*id)
                } else {
                    Err(FakeError)
                }
            }
            ColumnBinding::NewDefinition {
                name,
                data_type,
                is_multi_select,
                // Options are attached through `add_options`, as in Postgres.
                options: _,
            } => {
                let def = definition(
                    name,
                    *data_type,
                    *is_multi_select,
                    PropertyOwner::Database { database_id },
                );
                let id = def.definition.id;
                self.0.lock().unwrap().definitions.insert(id, def);
                Ok(id)
            }
        }
    }
    async fn create_typed_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: DataType,
        is_multi_select: bool,
        specific_entity_type: Option<PropertyEntityType>,
    ) -> Result<PropertyDefinitionWithOptions, FakeError> {
        let mut def = definition(
            name,
            data_type,
            is_multi_select,
            PropertyOwner::Database { database_id },
        );
        def.definition.specific_entity_type = specific_entity_type;
        self.0
            .lock()
            .unwrap()
            .definitions
            .insert(def.definition.id, def.clone());
        Ok(def)
    }
    async fn delete_unused_definition(&self, id: PropertyDefinitionId) -> Result<(), FakeError> {
        self.0.lock().unwrap().definitions.remove(&id);
        Ok(())
    }
    async fn add_options(
        &self,
        definition_id: PropertyDefinitionId,
        values: &[PropertyOptionValue],
    ) -> Result<Vec<PropertyOption>, FakeError> {
        let mut w = self.0.lock().unwrap();
        let def = w.definitions.get_mut(&definition_id).ok_or(FakeError)?;
        let mut display_order = def
            .property_options
            .iter()
            .map(|o| o.display_order)
            .max()
            .map_or(0, |highest| highest + 1);
        let mut created = Vec::new();
        for value in values {
            let option = PropertyOption {
                id: Uuid::new_v4(),
                property_definition_id: definition_id,
                display_order,
                value: value.clone(),
                color: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            };
            def.property_options.push(option.clone());
            created.push(option);
            display_order += 1;
        }
        Ok(created)
    }
    async fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> Result<Vec<PropertyDefinitionWithOptions>, FakeError> {
        let w = self.0.lock().unwrap();
        Ok(ids
            .iter()
            .filter_map(|id| w.definitions.get(id).cloned())
            .collect())
    }
}

impl MagicTables for FakeMagic {
    type Err = FakeError;
    fn schemas(&self) -> Vec<TableSchema> {
        vec![TableSchema {
            sql_name: "people".into(),
            source: TableSource::Magic("people".into()),
            columns: vec![
                crate::outbound::rusqlite_executor::column(
                    "id",
                    crate::domain::models::SqlType::Text,
                ),
                crate::outbound::rusqlite_executor::column(
                    "email",
                    crate::domain::models::SqlType::Text,
                ),
            ]
            .into_iter()
            .map(|mut c| {
                c.writable = false;
                if c.sql_name == "id" {
                    c.entity_type = Some(model_entity::EntityType::User);
                }
                c
            })
            .collect(),
            primary_key: vec!["id".into()],
            foreign_keys: vec![],
            writable: false,
            aliases: vec![],
        }]
    }
    async fn materialize(
        &self,
        viewer: &Viewer,
        sql_name: &str,
        _columns: &[String],
    ) -> Result<(MaterializedTable, bool), FakeError> {
        assert_eq!(sql_name, "people");
        Ok((
            MaterializedTable {
                schema: self.schemas().remove(0),
                rows: vec![vec![
                    SqlValue::Text(viewer.user_id.as_ref().to_string()),
                    SqlValue::Text("me@macro.com".into()),
                ]],
            },
            self.0.lock().unwrap().magic_truncated,
        ))
    }
}

impl TableEventPublisher for FakeEvents {
    type Err = FakeError;
    async fn table_changed(
        &self,
        _database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<(), FakeError> {
        self.0.lock().unwrap().published.push((table_id, version));
        Ok(())
    }
}

impl AccessDirectory for FakeAccess {
    type Err = FakeError;
    async fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> Result<Vec<(DatabaseId, AccessGrant)>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .grants
            .get(viewer.user_id.as_ref())
            .cloned()
            .unwrap_or_default())
    }
}

#[derive(Clone)]
struct RecordingBroker(Shared);

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

type Service = DatabasesServiceImpl<
    FakeRepo,
    FakeDefs,
    FakeMagic,
    RusqliteExecutor,
    FakeEvents,
    FakeAccess,
    RecordingBroker,
>;

fn service(world: &Shared) -> Service {
    DatabasesServiceImpl::new(
        FakeRepo(world.clone()),
        FakeDefs(world.clone()),
        FakeMagic(world.clone()),
        RusqliteExecutor::new(ExecutorLimits::default()),
        FakeEvents(world.clone()),
        FakeAccess(world.clone()),
        RecordingBroker(world.clone()),
    )
}

/// The `event_type` tags of every broker event so far, in publish order.
fn broker_event_types(world: &Shared) -> Vec<String> {
    world
        .lock()
        .unwrap()
        .broker_events
        .iter()
        .map(|event| event["event_type"].as_str().unwrap_or_default().to_string())
        .collect()
}

fn definition(
    name: &str,
    data_type: DataType,
    multi: bool,
    owner: PropertyOwner,
) -> PropertyDefinitionWithOptions {
    PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: Uuid::new_v4(),
            owner,
            display_name: name.into(),
            data_type,
            is_multi_select: multi,
            specific_entity_type: (data_type == DataType::Entity)
                .then_some(PropertyEntityType::User),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_system: false,
            is_metadata: false,
        },
        property_options: vec![],
    }
}

fn receipt<T: RequiredPermission>(
    database_id: DatabaseId,
    user: &'static str,
    level: AccessLevel,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        self::user(user),
        Entity {
            entity_id: database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .expect("level satisfies the requirement")
}

/// A database with one table `Guests(name TEXT, status SELECT[Going|Declined], plus_ones NUMBER)`
/// containing one row, owned by OWNER and shared View-only with VIEWER.
async fn seeded() -> (Shared, Service, DatabaseId, TableId) {
    let world: Shared = Arc::default();
    let svc = service(&world);
    let database = svc
        .create_database(CreateDatabase {
            name: "Offsite".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap();
    let table_id = {
        let mut w = world.lock().unwrap();
        w.tables[0].name = "Guests".into();
        w.tables[0].id
    };
    let rec = receipt::<EditAccessLevel>(database.id, OWNER, AccessLevel::Owner);
    let name_col = svc
        .create_column(
            rec.clone_for_test(),
            viewer(OWNER),
            CreateColumn {
                infer_type: false,
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "Name".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
                    options: vec![],
                },
                config: None,
            },
        )
        .await
        .unwrap();
    let _ = name_col;
    let status_col = svc
        .create_column(
            rec.clone_for_test(),
            viewer(OWNER),
            CreateColumn {
                infer_type: false,
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "Status".into(),
                    data_type: DataType::SelectString,
                    is_multi_select: false,
                    options: vec!["Going".into(), "Declined".into()],
                },
                config: None,
            },
        )
        .await
        .unwrap();
    svc.create_column(
        rec,
        viewer(OWNER),
        CreateColumn {
            infer_type: false,
            table_id,
            binding: ColumnBinding::NewDefinition {
                name: "Plus ones".into(),
                data_type: DataType::Number,
                is_multi_select: false,
                options: vec![],
            },
            config: None,
        },
    )
    .await
    .unwrap();
    let _ = status_col;
    // Share View-only with VIEWER.
    world
        .lock()
        .unwrap()
        .grants
        .entry(VIEWER.into())
        .or_default()
        .push((database.id, AccessGrant::View));
    svc.exec_sql(
        viewer(OWNER),
        ExecRequest {
            sql: "INSERT INTO guests (name, status, plus_ones) VALUES ('Sam', 'Going', 2)".into(),
            base_versions: None,
        },
    )
    .await
    .unwrap();
    (world, svc, database.id, table_id)
}

trait CloneForTest {
    fn clone_for_test(&self) -> Self;
}
impl<T: RequiredPermission> CloneForTest for EntityAccessReceipt<T> {
    fn clone_for_test(&self) -> Self {
        EntityAccessReceipt::try_new(
            self.auth().clone(),
            self.entity().clone(),
            *self.entity_permission(),
        )
        .expect("an existing receipt still satisfies its requirement")
    }
}

#[tokio::test]
async fn create_database_grants_owner_and_starter_table() {
    let world: Shared = Arc::default();
    let svc = service(&world);
    let db = svc
        .create_database(CreateDatabase {
            name: "  Offsite ".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap();
    assert_eq!(db.name, "Offsite");
    let listed = svc.list_databases(viewer(OWNER)).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].grant, AccessGrant::Owner);
    assert!(
        svc.list_databases(viewer(STRANGER))
            .await
            .unwrap()
            .is_empty()
    );
    {
        let w = world.lock().unwrap();
        assert_eq!(w.tables.len(), 1);
        assert_eq!(w.tables[0].name, "Table 1");
    }

    let err = svc
        .create_database(CreateDatabase {
            name: "   ".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::InvalidSchemaOperation(_)));
}

#[tokio::test]
async fn queries_read_current_viewer_data_and_dependencies() {
    let (world, svc, database_id, table_id) = seeded().await;
    for caller in [OWNER, VIEWER] {
        let outcome = svc.query_sql(
            viewer(caller),
            "WITH guests_going AS (SELECT * FROM guests WHERE status = 'Going') SELECT name, plus_ones FROM guests_going".into(),
        ).await.unwrap();
        assert_eq!(outcome.results[0].rows[0][0], SqlValue::Text("Sam".into()));
        assert_eq!(outcome.changes_applied, 0);
        assert!(outcome.new_versions.is_empty());
        assert!(outcome.inserted_row_ids.is_empty());
        assert_eq!(outcome.read_tables, vec![table_id]);
        assert_eq!(outcome.read_database_ids, vec![database_id]);
        assert_eq!(
            outcome.read_versions[&table_id],
            world.lock().unwrap().tables[0].version
        );
    }
    let error = svc
        .query_sql(viewer(STRANGER), "SELECT * FROM guests".into())
        .await
        .unwrap_err();
    assert!(matches!(error, QueryError::Sql(_)));
}

#[tokio::test]
async fn saved_read_alias_survives_renames_and_duplicate_table_names() {
    let (_world, svc, database_id, table_id) = seeded().await;
    let detail = svc
        .get_database(
            receipt::<ViewAccessLevel>(database_id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
        )
        .await
        .unwrap();
    let read_name = detail.tables[0].read_sql_name.clone();
    let sql = format!("SELECT name FROM \"{read_name}\"");
    assert_eq!(
        text_cells(&svc.query_sql(viewer(OWNER), sql.clone()).await.unwrap()),
        vec![vec!["Sam"]]
    );

    let other = svc
        .create_database(CreateDatabase {
            name: "Another offsite".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap();
    svc.create_table(
        receipt::<EditAccessLevel>(other.id, OWNER, AccessLevel::Owner),
        CreateTable {
            database_id: other.id,
            name: "Guests".into(),
        },
    )
    .await
    .unwrap();
    svc.rename_database(
        receipt::<EditAccessLevel>(database_id, OWNER, AccessLevel::Owner),
        "Renamed offsite".into(),
    )
    .await
    .unwrap();

    for caller in [OWNER, VIEWER] {
        let answer = svc.query_sql(viewer(caller), sql.clone()).await.unwrap();
        assert_eq!(text_cells(&answer), vec![vec!["Sam"]]);
        assert_eq!(answer.read_tables, vec![table_id]);
        assert_eq!(answer.read_database_ids, vec![database_id]);
        assert_eq!(answer.changes_applied, 0);
    }
    let stranger = svc
        .query_sql(viewer(STRANGER), sql.clone())
        .await
        .unwrap_err();
    assert!(matches!(stranger, QueryError::Sql(_)));
    let write = exec(
        &svc,
        OWNER,
        &format!("UPDATE \"{read_name}\" SET name = 'Changed'"),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(&write, QueryError::Sql(message) if message.contains("because it is a view")),
        "{write:?}"
    );
    assert_eq!(
        text_cells(&svc.query_sql(viewer(OWNER), sql).await.unwrap()),
        vec![vec!["Sam"]]
    );
}

#[tokio::test]
async fn queries_refuse_writes_even_for_owners_without_changes_or_events() {
    let (world, svc, _database_id, table_id) = seeded().await;
    let (applied, published, version) = {
        let world = world.lock().unwrap();
        (
            world.applied.len(),
            world.published.len(),
            world.tables[0].version,
        )
    };
    for sql in [
        "UPDATE guests SET status = 'Declined'",
        "DELETE FROM guests",
        "INSERT INTO guests (name) VALUES ('Intruder')",
        "SELECT * FROM guests; UPDATE guests SET name = 'Changed'",
        "WITH current AS (SELECT row_id FROM guests) DELETE FROM guests WHERE row_id IN (SELECT row_id FROM current)",
        "UPDATE guests SET name = 'Changed' WHERE 0",
        "PRAGMA writable_schema = ON",
        "DROP TABLE guests",
    ] {
        let error = svc.query_sql(viewer(OWNER), sql.into()).await.unwrap_err();
        assert!(matches!(error, QueryError::ReadOnly(_)), "{sql}: {error:?}");
    }
    let world = world.lock().unwrap();
    assert_eq!(world.applied.len(), applied);
    assert_eq!(world.published.len(), published);
    assert_eq!(world.tables[0].version, version);
    assert_eq!(world.rows[&table_id].len(), 1);
}

#[tokio::test]
async fn exec_reads_writes_and_joins_magic_tables() {
    let (world, svc, _db, table_id) = seeded().await;

    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "SELECT g.name, g.status, g.plus_ones, p.email FROM guests g JOIN people p ON p.id = p.id".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(outcome.changes_applied, 0);
    let result = &outcome.results[0];
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0][0], SqlValue::Text("Sam".into()));
    assert_eq!(
        result.rows[0][1],
        SqlValue::Text("Going".into()),
        "options read as display values"
    );
    assert_eq!(result.rows[0][2], SqlValue::Real(2.0));
    assert_eq!(result.rows[0][3], SqlValue::Text("me@macro.com".into()));
    assert!(outcome.read_tables.contains(&table_id));

    let published_before = world.lock().unwrap().published.len();
    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET status = 'Declined', plus_ones = NULL WHERE name = 'Sam'"
                    .into(),
                base_versions: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(outcome.changes_applied, 1);
    assert_eq!(outcome.new_versions.len(), 1);
    {
        let w = world.lock().unwrap();
        assert_eq!(
            w.published.len(),
            published_before + 1,
            "the update published exactly once"
        );
        let RowChange::Update { cells, .. } = &w.applied[1] else {
            panic!("update applied")
        };
        assert!(cells.values().any(|v| v.is_none()), "NULL clears the cell");
        let row = &w.rows[&table_id][0];
        assert_eq!(row.cells.len(), 2, "plus_ones cleared: {:?}", row.cells);
    }
}

#[tokio::test]
async fn view_grant_can_read_but_not_write() {
    let (_world, svc, _db, _table) = seeded().await;
    let read = svc
        .exec_sql(
            viewer(VIEWER),
            ExecRequest {
                sql: "SELECT count(*) FROM guests".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(read.results[0].rows[0][0], SqlValue::Integer(1));

    let err = svc
        .exec_sql(
            viewer(VIEWER),
            ExecRequest {
                sql: "DELETE FROM guests".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");

    // A stranger's catalog has no such table at all.
    let err = svc
        .exec_sql(
            viewer(STRANGER),
            ExecRequest {
                sql: "SELECT * FROM guests".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, QueryError::Sql(ref msg) if msg.contains("no such table")),
        "{err:?}"
    );
}

#[tokio::test]
async fn validity_and_versions_are_enforced() {
    let (_world, svc, _db, table_id) = seeded().await;
    let err = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET status = 'Maybe'".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, QueryError::Sql(ref msg) if msg.contains("CHECK constraint")),
        "{err:?}"
    );

    let err = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET name = 'Sam K'".into(),
                base_versions: Some(HashMap::from([(table_id, TableVersion(41))])),
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, QueryError::VersionConflict { table_id: t } if t == table_id),
        "{err:?}"
    );

    let err = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE people SET email = 'x'".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");

    let err = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "DROP TABLE guests".into(),
                base_versions: None,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");
}

#[tokio::test]
async fn schema_operations_respect_receipts() {
    let (_world, svc, db, table_id) = seeded().await;
    let other = Uuid::new_v4();
    let err = svc
        .create_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id: other,
                name: "Nope".into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::Unauthorized));

    let err = svc
        .create_column(
            receipt::<EditAccessLevel>(other, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            CreateColumn {
                infer_type: false,
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "X".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
                    options: vec![],
                },
                config: None,
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, DatabaseError::NotFound),
        "a table outside the receipted database looks missing"
    );

    let detail = svc
        .get_database(
            receipt::<ViewAccessLevel>(db, VIEWER, AccessLevel::View),
            viewer(VIEWER),
        )
        .await
        .unwrap();
    assert_eq!(detail.grant, AccessGrant::View);
    assert_eq!(detail.tables[0].sql_name, "guests");
    assert_eq!(detail.tables[0].columns.len(), 3);
    assert!(detail.tables[0].columns.iter().all(|c| !c.writable));
}

#[tokio::test]
async fn schema_reads_name_tables_against_the_whole_catalog() {
    let world: Shared = Arc::default();
    let svc = service(&world);
    let mut ids = Vec::new();
    for name in ["First", "Second"] {
        let db = svc
            .create_database(CreateDatabase {
                name: name.into(),
                owner_id: user(OWNER),
            })
            .await
            .unwrap();
        ids.push(db.id);
    }

    // Both starter tables are "Table 1"; the bare name is ambiguous, so the
    // detail must hand out the same qualified names exec resolves.
    let mut sql_names = Vec::new();
    for id in &ids {
        let detail = svc
            .get_database(
                receipt::<ViewAccessLevel>(*id, OWNER, AccessLevel::Owner),
                viewer(OWNER),
            )
            .await
            .unwrap();
        assert_eq!(detail.tables.len(), 1);
        let sql_name = detail.tables[0].sql_name.clone();
        assert_ne!(
            sql_name, "table_1",
            "bare name must not be handed out while ambiguous"
        );
        let outcome = exec(&svc, OWNER, &format!("SELECT count(*) FROM \"{sql_name}\""))
            .await
            .unwrap();
        assert_eq!(outcome.results.len(), 1);
        sql_names.push(sql_name);
    }
    assert_ne!(sql_names[0], sql_names[1]);
    assert!(
        exec(&svc, OWNER, "SELECT count(*) FROM table_1")
            .await
            .is_err(),
        "the ambiguous bare name resolves nowhere"
    );

    // The snapshot is scoped to one database even though it was named
    // against the whole catalog.
    let snapshot = svc
        .sqlite_snapshot(
            receipt::<ViewAccessLevel>(ids[0], OWNER, AccessLevel::Owner),
            viewer(OWNER),
        )
        .await
        .unwrap();
    assert_eq!(snapshot.versions.len(), 1);

    // …and a snapshot is a standalone file containing that database alone, so
    // its tables are named against it and not against the viewer's catalog:
    // the name that is ambiguous online is unambiguous, and bare, in here.
    let path = std::env::temp_dir().join(format!("databases-naming-{}.sqlite", Uuid::new_v4()));
    std::fs::write(&path, &snapshot.bytes).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    let names: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(names, vec!["table_1".to_string()], "{names:?}");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn same_named_uuidv7_databases_support_first_load_writes_and_snapshots() {
    for database_count in [2, 3] {
        let world: Shared = Arc::default();
        let svc = service(&world);
        let mut ids = Vec::new();
        {
            let mut world = world.lock().unwrap();
            for index in 1..=database_count {
                // UUIDv7 databases created close together share their first six
                // hexadecimal characters; the suffix must distinguish them.
                let database_id = Uuid::from_u128(0x01a0b6bf_0000_7000_8000_000000000000 + index);
                let table_id = Uuid::from_u128(0x01a0b6bf_0001_7000_8000_000000000000 + index);
                world.databases.push(Database {
                    id: database_id,
                    name: "Untitled database".into(),
                    owner_id: OWNER.into(),
                    created_at: Utc::now(),
                    trashed_at: None,
                });
                world.tables.push(Table {
                    id: table_id,
                    database_id,
                    name: "Table 1".into(),
                    position: "a0".into(),
                    version: TableVersion(0),
                });
                for (caller, grant) in [(OWNER, AccessGrant::Owner), (VIEWER, AccessGrant::View)] {
                    world
                        .grants
                        .entry(caller.into())
                        .or_default()
                        .push((database_id, grant));
                }
                ids.push((database_id, table_id));
            }
        }

        let mut sql_names = HashSet::new();
        for (index, (database_id, table_id)) in ids.into_iter().enumerate() {
            let detail = svc
                .get_database(
                    receipt::<ViewAccessLevel>(database_id, OWNER, AccessLevel::Owner),
                    viewer(OWNER),
                )
                .await
                .unwrap();
            let table = &detail.tables[0];

            // This is the first grid load, before the user adds any columns.
            // Both read endpoints build the whole viewer catalog, even though
            // the statement references only this database's starter table.
            let first_load = svc
                .query_sql(
                    viewer(OWNER),
                    format!("SELECT * FROM \"{}\"", table.read_sql_name),
                )
                .await
                .unwrap();
            assert!(first_load.results[0].rows.is_empty());
            assert_eq!(first_load.read_tables, vec![table_id]);
            assert!(sql_names.insert(table.sql_name.clone()));
            let empty = exec(
                &svc,
                OWNER,
                &format!("SELECT * FROM \"{}\"", table.sql_name),
            )
            .await
            .unwrap();
            assert!(empty.results[0].rows.is_empty());

            add_column(
                &svc,
                database_id,
                table_id,
                "Name",
                DataType::String,
                false,
                None,
            )
            .await;
            let label = format!("Record {index}");
            let inserted = exec(
                &svc,
                OWNER,
                &format!(
                    "INSERT INTO \"{}\" (name) VALUES ('{label}')",
                    table.sql_name
                ),
            )
            .await
            .unwrap();
            assert_eq!(inserted.inserted_row_ids.len(), 1);
            let updated_label = format!("Updated {index}");
            let updated = svc
                .exec_sql(
                    viewer(OWNER),
                    ExecRequest {
                        sql: format!("UPDATE \"{}\" SET name = '{updated_label}'", table.sql_name),
                        base_versions: Some(inserted.new_versions),
                    },
                )
                .await
                .unwrap();
            assert_eq!(updated.changes_applied, 1);
            for caller in [OWNER, VIEWER] {
                let read = svc
                    .query_sql(
                        viewer(caller),
                        format!("SELECT name FROM \"{}\"", table.read_sql_name),
                    )
                    .await
                    .unwrap();
                assert_eq!(text_cells(&read), vec![vec![updated_label.clone()]]);
                assert_eq!(read.read_database_ids, vec![database_id]);
                assert_eq!(read.read_tables, vec![table_id]);
            }

            let snapshot = svc
                .sqlite_snapshot(
                    receipt::<ViewAccessLevel>(database_id, VIEWER, AccessLevel::View),
                    viewer(VIEWER),
                )
                .await
                .unwrap();
            assert_eq!(snapshot.versions, updated.new_versions);
            let path = std::env::temp_dir()
                .join(format!("databases-shared-prefix-{}.sqlite", Uuid::new_v4()));
            std::fs::write(&path, &snapshot.bytes).unwrap();
            let conn = rusqlite::Connection::open(&path).unwrap();
            let names: Vec<String> = conn
                .prepare("SELECT name FROM table_1")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(names, vec![updated_label]);
            drop(conn);
            std::fs::remove_file(path).unwrap();
        }
    }
}

#[tokio::test]
async fn snapshot_contains_the_database() {
    let (_world, svc, db, _table) = seeded().await;
    let snapshot = svc
        .sqlite_snapshot(
            receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
        )
        .await
        .unwrap();
    assert!(snapshot.bytes.starts_with(b"SQLite format 3\0"));
    assert_eq!(snapshot.versions.len(), 1);
}

#[tokio::test]
async fn rename_validates_the_name_and_writes_it() {
    let (world, svc, db, _table) = seeded().await;

    svc.rename_database(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        "  Winter Offsite  ".into(),
    )
    .await
    .unwrap();
    assert_eq!(world.lock().unwrap().databases[0].name, "Winter Offsite");

    let err = svc
        .rename_database(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            "   ".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::InvalidSchemaOperation(_)));

    let err = svc
        .rename_database(
            receipt::<EditAccessLevel>(Uuid::new_v4(), OWNER, AccessLevel::Owner),
            "Elsewhere".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));
}

#[tokio::test]
async fn table_rename_preserves_answers_and_retries_without_overwriting_a_new_name() {
    let (world, svc, db, table_id) = seeded().await;
    let alias = catalog::read_table_name(table_id);
    let sql = format!("SELECT name FROM {alias}");
    let before = svc.query_sql(viewer(OWNER), sql.clone()).await.unwrap();
    let renamed = svc
        .rename_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            "  Attendees  ".into(),
            "Guests".into(),
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "Attendees");
    assert_eq!(
        world.lock().unwrap().published.last(),
        Some(&(table_id, renamed.version))
    );
    assert_eq!(
        text_cells(&svc.query_sql(viewer(OWNER), sql).await.unwrap()),
        text_cells(&before)
    );
    let retried = svc
        .rename_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            "Attendees".into(),
            "Guests".into(),
        )
        .await
        .unwrap();
    assert_eq!(retried.version, renamed.version);
    let error = svc
        .rename_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            "People".into(),
            "Guests".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::InvalidSchemaOperation(_)));
    assert_eq!(
        world
            .lock()
            .unwrap()
            .tables
            .iter()
            .find(|t| t.id == table_id)
            .unwrap()
            .name,
        "Attendees"
    );
}

#[tokio::test]
async fn table_rename_rejects_invalid_names_foreign_tables_and_trashed_databases() {
    let (_world, svc, db, table_id) = seeded().await;
    svc.create_table(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        CreateTable {
            database_id: db,
            name: "People".into(),
        },
    )
    .await
    .unwrap();
    for name in [" ", " people "] {
        let error = svc
            .rename_table(
                receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
                table_id,
                name.into(),
                "Guests".into(),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, DatabaseError::InvalidSchemaOperation(_)));
    }
    let other = svc
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap();
    let error = svc
        .rename_table(
            receipt::<EditAccessLevel>(other.id, OWNER, AccessLevel::Owner),
            table_id,
            "People".into(),
            "Guests".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound));
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let error = svc
        .rename_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            table_id,
            "People".into(),
            "Guests".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound));
}

#[tokio::test]
async fn trash_hides_the_database_and_restore_brings_it_back() {
    let (world, svc, db, _table) = seeded().await;

    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let trashed_at = world.lock().unwrap().databases[0].trashed_at;
    assert!(trashed_at.is_some());

    // A trashed database is invisible to listing, reads, and renames.
    assert!(svc.list_databases(viewer(OWNER)).await.unwrap().is_empty());
    let err = svc
        .get_database(
            receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));
    let err = svc
        .rename_database(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            "Renamed".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));

    // Trashing again keeps the original timestamp.
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(world.lock().unwrap().databases[0].trashed_at, trashed_at);

    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert!(world.lock().unwrap().databases[0].trashed_at.is_none());
    assert_eq!(svc.list_databases(viewer(OWNER)).await.unwrap().len(), 1);

    // Restoring a live database is a no-op, not an error.
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
}

#[tokio::test]
async fn permanent_delete_removes_the_database_and_its_grants() {
    let (world, svc, db, _table) = seeded().await;

    svc.delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    {
        let w = world.lock().unwrap();
        assert!(w.databases.is_empty());
        assert!(w.tables.is_empty());
        assert!(w.grants.values().all(|grants| grants.is_empty()));
    }
    assert!(svc.list_databases(viewer(VIEWER)).await.unwrap().is_empty());

    let err = svc
        .delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));
}

#[tokio::test]
async fn lifecycle_operations_act_on_trashed_databases() {
    let (world, svc, db, _table) = seeded().await;
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    svc.delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    assert!(world.lock().unwrap().databases.is_empty());
}

// ===== Integration: grants across databases, links, HAS, snapshots, versions =====

async fn exec(svc: &Service, user: &'static str, sql: &str) -> Result<ExecOutcome, QueryError> {
    svc.exec_sql(
        viewer(user),
        ExecRequest {
            sql: sql.into(),
            base_versions: None,
        },
    )
    .await
}

fn text_cells(outcome: &ExecOutcome) -> Vec<Vec<String>> {
    outcome.results[0]
        .rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|v| match v {
                    SqlValue::Text(t) => t.clone(),
                    SqlValue::Integer(i) => i.to_string(),
                    SqlValue::Real(f) => f.to_string(),
                    SqlValue::Null => "NULL".into(),
                })
                .collect()
        })
        .collect()
}

async fn add_column(
    svc: &Service,
    db: DatabaseId,
    table_id: TableId,
    name: &str,
    data_type: DataType,
    multi: bool,
    config: Option<ColumnConfig>,
) -> ColumnId {
    new_column(svc, db, table_id, name, data_type, multi, &[], config)
        .await
        .unwrap()
}

/// A select/tag column created with its options, which is the only way one
/// ever accepts a value.
async fn add_select_column(
    svc: &Service,
    db: DatabaseId,
    table_id: TableId,
    name: &str,
    data_type: DataType,
    multi: bool,
    options: &[&str],
) -> ColumnId {
    try_add_select_column(svc, db, table_id, name, data_type, multi, options)
        .await
        .unwrap()
}

/// The same, reporting why the service refused instead of panicking.
async fn try_add_select_column(
    svc: &Service,
    db: DatabaseId,
    table_id: TableId,
    name: &str,
    data_type: DataType,
    multi: bool,
    options: &[&str],
) -> Result<ColumnId, DatabaseError> {
    new_column(svc, db, table_id, name, data_type, multi, options, None).await
}

#[allow(clippy::too_many_arguments)]
async fn new_column(
    svc: &Service,
    db: DatabaseId,
    table_id: TableId,
    name: &str,
    data_type: DataType,
    multi: bool,
    options: &[&str],
    config: Option<ColumnConfig>,
) -> Result<ColumnId, DatabaseError> {
    svc.create_column(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        viewer(OWNER),
        CreateColumn {
            infer_type: false,
            table_id,
            binding: ColumnBinding::NewDefinition {
                name: name.into(),
                data_type,
                is_multi_select: multi,
                options: options.iter().map(|o| (*o).to_string()).collect(),
            },
            config,
        },
    )
    .await
}

/// VIEWER owns a second database (`Rooms`) while holding View on OWNER's.
/// Joins across both work; writes land only where the grant allows.
#[tokio::test]
async fn joins_span_databases_with_different_grants() {
    let (world, svc, _db1, guests) = seeded().await;
    let rooms_db = svc
        .create_database(CreateDatabase {
            name: "Venue".into(),
            owner_id: user(VIEWER),
        })
        .await
        .unwrap();
    let rooms = {
        let mut w = world.lock().unwrap();
        let t = w
            .tables
            .iter_mut()
            .find(|t| t.database_id == rooms_db.id)
            .unwrap();
        t.name = "Rooms".into();
        t.id
    };
    svc.create_column(
        receipt::<EditAccessLevel>(rooms_db.id, VIEWER, AccessLevel::Owner),
        viewer(VIEWER),
        CreateColumn {
            infer_type: false,
            table_id: rooms,
            binding: ColumnBinding::NewDefinition {
                name: "Name".into(),
                data_type: DataType::String,
                is_multi_select: false,
                options: vec![],
            },
            config: None,
        },
    )
    .await
    .unwrap();

    exec(
        &svc,
        VIEWER,
        "INSERT INTO rooms (name) VALUES ('Main Hall')",
    )
    .await
    .unwrap();
    let joined = exec(
        &svc,
        VIEWER,
        "SELECT g.name, r.name FROM guests g CROSS JOIN rooms r",
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&joined), vec![vec!["Sam", "Main Hall"]]);
    assert!(joined.read_tables.contains(&guests));
    assert!(joined.read_tables.contains(&rooms));

    // Read the View-only table while writing the owned one.
    let outcome = exec(
        &svc,
        VIEWER,
        "UPDATE rooms SET name = (SELECT name FROM guests) || ' Room'",
    )
    .await
    .unwrap();
    assert_eq!(outcome.changes_applied, 1);
    assert_eq!(outcome.new_versions.len(), 1);
    assert!(outcome.new_versions.contains_key(&rooms));

    let err = exec(
        &svc,
        VIEWER,
        "INSERT INTO guests (name) SELECT name FROM rooms",
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, QueryError::ReadOnly(ref m) if m.contains("guests")),
        "{err:?}"
    );

    // OWNER has no grant on Venue: the table does not exist for them.
    let err = exec(&svc, OWNER, "SELECT * FROM rooms").await.unwrap_err();
    assert!(
        matches!(err, QueryError::Sql(ref m) if m.contains("no such table: rooms")),
        "{err:?}"
    );
    // Nothing leaked into the other database's version map.
    let w = world.lock().unwrap();
    assert!(w.applied.iter().all(|c| match c {
        RowChange::Insert { table_id, .. } | RowChange::Update { table_id, .. } => {
            *table_id == guests || *table_id == rooms
        }
        _ => true,
    }));
}

/// A link column end to end: the edge is written through the junction,
/// applied as `Link`, and read back through both the JSON column and the
/// junction; deleting the edge applies `Unlink`.
#[tokio::test]
async fn link_columns_round_trip_through_junction_sql() {
    let (world, svc, db, guests) = seeded().await;
    let sessions = svc
        .create_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id: db,
                name: "Sessions".into(),
            },
        )
        .await
        .unwrap();
    add_column(
        &svc,
        db,
        sessions.id,
        "Title",
        DataType::String,
        false,
        None,
    )
    .await;
    let link_column = add_column(
        &svc,
        db,
        guests,
        "Sessions",
        DataType::Entity,
        false,
        Some(ColumnConfig::Link {
            database_id: db,
            table_id: sessions.id,
        }),
    )
    .await;

    exec(
        &svc,
        OWNER,
        "INSERT INTO sessions (title) VALUES ('Keynote')",
    )
    .await
    .unwrap();
    let before = exec(&svc, OWNER, "SELECT sessions FROM guests")
        .await
        .unwrap();
    assert_eq!(text_cells(&before), vec![vec!["[]"]]);

    let outcome = exec(
        &svc,
        OWNER,
        "INSERT INTO guests__sessions (row_id, linked_id) \
         SELECT g.row_id, s.row_id FROM guests g, sessions s WHERE s.title = 'Keynote'",
    )
    .await
    .unwrap();
    assert_eq!(outcome.changes_applied, 1);
    let session_row = world.lock().unwrap().rows[&sessions.id][0].id;
    let guest_row = world.lock().unwrap().rows[&guests][0].id;
    assert_eq!(
        world.lock().unwrap().applied.last().unwrap(),
        &RowChange::Link {
            column_id: link_column,
            source_row_id: guest_row,
            target_row_id: session_row,
        }
    );

    let via_json = exec(&svc, OWNER, "SELECT sessions FROM guests")
        .await
        .unwrap();
    assert_eq!(
        text_cells(&via_json),
        vec![vec![format!("[\"{session_row}\"]")]]
    );
    let via_junction = exec(
        &svc,
        OWNER,
        "SELECT g.name, s.title FROM guests g \
         JOIN guests__sessions j ON j.row_id = g.row_id \
         JOIN sessions s ON s.row_id = j.linked_id",
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&via_junction), vec![vec!["Sam", "Keynote"]]);
    let via_has = exec(
        &svc,
        OWNER,
        &format!("SELECT name FROM guests WHERE sessions HAS '{session_row}'"),
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&via_has), vec![vec!["Sam"]]);

    // The JSON column is derived: writing it is refused before execution.
    let err = exec(&svc, OWNER, "UPDATE guests SET sessions = '[]'")
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");

    let outcome = exec(&svc, OWNER, "DELETE FROM guests__sessions")
        .await
        .unwrap();
    assert_eq!(outcome.changes_applied, 1);
    assert_eq!(
        world.lock().unwrap().applied.last().unwrap(),
        &RowChange::Unlink {
            column_id: link_column,
            source_row_id: guest_row,
            target_row_id: session_row,
        }
    );
    let after = exec(&svc, OWNER, "SELECT sessions FROM guests")
        .await
        .unwrap();
    assert_eq!(text_cells(&after), vec![vec!["[]"]]);

    // The viewer sees the junction but cannot write it.
    let err = exec(
        &svc,
        VIEWER,
        &format!(
            "INSERT INTO guests__sessions (row_id, linked_id) VALUES ('{guest_row}', '{session_row}')"
        ),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");
}

/// `HAS` over a multi-select column at the service level: the desugared
/// `json_each` must not be mistaken for a table to materialize.
#[tokio::test]
async fn has_predicate_runs_end_to_end() {
    let (world, svc, db, guests) = seeded().await;
    let _ = world;
    add_select_column(&svc, db, guests, "Tags", DataType::Tag, true, &["vip"]).await;
    exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name, tags) VALUES ('Tara', '[\"vip\"]'); \
         INSERT INTO guests (name, tags) VALUES ('Uma', '[]')",
    )
    .await
    .unwrap();

    let vip = exec(
        &svc,
        OWNER,
        "SELECT name FROM guests WHERE tags HAS 'vip' ORDER BY name",
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&vip), vec![vec!["Tara"]]);
    assert_eq!(vip.read_tables, vec![guests]);

    let not_vip = exec(
        &svc,
        OWNER,
        "SELECT name FROM guests WHERE NOT (tags HAS 'vip') ORDER BY name",
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&not_vip), vec![vec!["Sam"], vec!["Uma"]]);

    let via_mirror = exec(
        &svc,
        OWNER,
        "SELECT g.name FROM guests g JOIN guests__tags t ON t.row_id = g.row_id WHERE t.linked_id = 'vip'",
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&via_mirror), vec![vec!["Tara"]]);

    let err = exec(&svc, OWNER, "UPDATE guests SET tags = '[\"nope\"]'")
        .await
        .unwrap_err();
    assert!(
        matches!(err, QueryError::UntranslatableChange(ref m) if m.contains("not an option")),
        "{err:?}"
    );
}

#[tokio::test]
async fn snapshot_reopens_with_rows_and_junctions() {
    let (_world, svc, db, guests) = seeded().await;
    add_column(
        &svc,
        db,
        guests,
        "Sessions",
        DataType::Entity,
        false,
        Some(ColumnConfig::Link {
            database_id: db,
            table_id: guests,
        }),
    )
    .await;
    let snapshot = svc
        .sqlite_snapshot(
            receipt::<ViewAccessLevel>(db, VIEWER, AccessLevel::View),
            viewer(VIEWER),
        )
        .await
        .unwrap();
    assert_eq!(snapshot.versions.get(&guests), Some(&TableVersion(1)));

    let path = std::env::temp_dir().join(format!("databases-service-{}.sqlite", Uuid::new_v4()));
    std::fs::write(&path, &snapshot.bytes).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    let (name, status, plus_ones, sessions): (String, String, f64, String) = conn
        .query_row(
            "SELECT name, status, plus_ones, sessions FROM guests",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        (name.as_str(), status.as_str(), plus_ones, sessions.as_str()),
        ("Sam", "Going", 2.0, "[]")
    );
    let junction_rows: i64 = conn
        .query_row("SELECT count(*) FROM guests__sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(junction_rows, 0);
    let strict: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name = 'guests'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(strict.contains("STRICT"), "{strict}");
    drop(conn);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn base_versions_gate_only_written_tables() {
    let (_world, svc, _db, guests) = seeded().await;
    let other = Uuid::new_v4();

    // A matching version passes.
    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET name = 'Sam K'".into(),
                base_versions: Some(HashMap::from([(guests, TableVersion(1))])),
            },
        )
        .await
        .unwrap();
    assert_eq!(outcome.changes_applied, 1);

    // Versions for tables the statement does not write are ignored.
    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET name = 'Sam'".into(),
                base_versions: Some(HashMap::from([(other, TableVersion(99))])),
            },
        )
        .await
        .unwrap();
    assert_eq!(outcome.changes_applied, 1);

    // Reads never conflict.
    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "SELECT name FROM guests".into(),
                base_versions: Some(HashMap::from([(guests, TableVersion(99))])),
            },
        )
        .await
        .unwrap();
    assert_eq!(text_cells(&outcome), vec![vec!["Sam"]]);

    // A stale version on a written table conflicts before anything runs.
    let err = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "DELETE FROM guests".into(),
                base_versions: Some(HashMap::from([(guests, TableVersion(99))])),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, QueryError::VersionConflict { table_id } if table_id == guests));
    let still_there = exec(&svc, OWNER, "SELECT count(*) FROM guests")
        .await
        .unwrap();
    assert_eq!(still_there.results[0].rows[0][0], SqlValue::Integer(1));
}

/// A statement that fails validation midway applies nothing and bumps no
/// versions, even when earlier statements in the batch were valid.
#[tokio::test]
async fn failed_batches_apply_nothing() {
    let (world, svc, _db, _guests) = seeded().await;
    let applied_before = world.lock().unwrap().applied.len();
    let published_before = world.lock().unwrap().published.len();
    let err = exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name) VALUES ('Zed'); UPDATE guests SET status = 'Maybe'",
    )
    .await
    .unwrap_err();
    assert!(matches!(err, QueryError::Sql(_)), "{err:?}");
    let w = world.lock().unwrap();
    assert_eq!(w.applied.len(), applied_before);
    assert_eq!(w.published.len(), published_before);
    assert_eq!(w.rows.values().map(Vec::len).sum::<usize>(), 1);
}

#[tokio::test]
async fn exec_reports_the_version_of_every_table_it_read() {
    let (world, svc, _db, guests) = seeded().await;

    // A pure read reports the version it materialized, and writes nothing.
    let outcome = exec(&svc, OWNER, "SELECT name FROM guests").await.unwrap();
    assert_eq!(outcome.read_tables, vec![guests]);
    assert_eq!(
        outcome.read_versions.get(&guests),
        Some(&TableVersion(1)),
        "the read must report the version it saw"
    );
    assert!(outcome.new_versions.is_empty());

    // Handing those versions straight back is an accurate compare-and-set:
    // nothing moved in between, so the write lands.
    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET name = 'Sam K'".into(),
                base_versions: Some(outcome.read_versions.clone()),
            },
        )
        .await
        .unwrap();
    assert_eq!(outcome.changes_applied, 1);
    // A write reports both: the version its read saw, and the one it left.
    assert_eq!(outcome.read_versions.get(&guests), Some(&TableVersion(1)));
    assert_eq!(outcome.new_versions.get(&guests), Some(&TableVersion(2)));

    // The same base versions are now stale, and the second attempt conflicts —
    // which is the whole point of handing them to the client.
    let stale = HashMap::from([(guests, TableVersion(1))]);
    let err = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "UPDATE guests SET name = 'Sam L'".into(),
                base_versions: Some(stale),
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, QueryError::VersionConflict { table_id } if table_id == guests),
        "{err:?}"
    );

    // Omitting them is still allowed and still last-write-wins.
    let _ = world;
    exec(&svc, OWNER, "UPDATE guests SET name = 'Sam M'")
        .await
        .expect("a write with no base versions commits blind");
}

#[tokio::test]
async fn a_truncated_magic_table_may_be_read_but_never_written_from() {
    let (world, svc, _db, _guests) = seeded().await;
    {
        let mut w = world.lock().unwrap();
        w.applied.clear();
        w.magic_truncated = true;
    }

    // Reading one is merely incomplete, and says so.
    let outcome = exec(&svc, OWNER, "SELECT email FROM people").await.unwrap();
    assert_eq!(outcome.truncated_tables, vec!["people".to_string()]);

    // Writing from one is wrong: the statement never saw the missing rows.
    let err = exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name) SELECT email FROM people",
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, QueryError::TruncatedDependency(ref tables) if tables.contains("people")),
        "{err:?}"
    );
    assert!(
        world.lock().unwrap().applied.is_empty(),
        "nothing may reach the repo"
    );

    // The same write is fine once the table fits.
    world.lock().unwrap().magic_truncated = false;
    exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name) SELECT email FROM people",
    )
    .await
    .expect("an untruncated dependency is writable");
}

#[tokio::test]
async fn rows_are_fetched_one_over_the_materialization_cap() {
    let (world, svc, _db, _guests) = seeded().await;
    world.lock().unwrap().fetch_row_limits.clear();

    exec(&svc, OWNER, "SELECT name FROM guests").await.unwrap();

    assert_eq!(
        world.lock().unwrap().fetch_row_limits,
        vec![MAX_MATERIALIZED_ROWS + 1],
        "the cap is pushed into the query, not applied after loading everything"
    );
}

// ===== Select options are explicit schema =====

/// Column id of the one column of `table_id` holding `data_type`.
fn column_of_type(world: &Shared, table_id: TableId, data_type: DataType) -> ColumnId {
    let w = world.lock().unwrap();
    w.columns
        .iter()
        .find(|column| {
            column.table_id == table_id
                && w.definitions
                    .get(&column.property_definition_id)
                    .is_some_and(|d| d.definition.data_type == data_type)
        })
        .expect("the seeded table has such a column")
        .id
}

/// A select column only accepts the labels it was created with — which is why
/// creating one without options makes it unwritable.
#[tokio::test]
async fn select_options_are_created_with_the_column() {
    let (_world, svc, _db, _guests) = seeded().await;

    exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name, status) VALUES ('Ada', 'Declined')",
    )
    .await
    .expect("a listed option is accepted");

    let err = exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name, status) VALUES ('Bo', 'Waitlisted')",
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, QueryError::Sql(ref m) if m.contains("CHECK constraint")),
        "{err:?}"
    );
}

#[tokio::test]
async fn a_select_column_with_no_options_accepts_nothing() {
    let (_world, svc, db, guests) = seeded().await;
    add_select_column(
        &svc,
        db,
        guests,
        "Stage",
        DataType::SelectString,
        false,
        &[],
    )
    .await;

    let err = exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name, stage) VALUES ('Ada', 'Main')",
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, QueryError::Sql(ref m) if m.contains("CHECK constraint")),
        "{err:?}"
    );
}

/// The point of the operation: the write that failed succeeds once the option
/// exists, and the table's version moves because its compiled schema did.
#[tokio::test]
async fn add_column_options_extends_what_sql_accepts_and_bumps_the_version() {
    let (world, svc, db, guests) = seeded().await;
    let status = column_of_type(&world, guests, DataType::SelectString);
    let version_before = world.lock().unwrap().tables[0].version;
    let published_before = world.lock().unwrap().published.len();

    let column = svc
        .add_column_options(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            AddColumnOptions {
                table_id: guests,
                column_id: status,
                labels: vec!["Waitlisted".into()],
            },
        )
        .await
        .expect("edit access may extend a select column");

    assert_eq!(column.sql_name, "status");
    assert_eq!(
        catalog::option_labels(&column.definition)
            .into_iter()
            .map(|(_, label)| label)
            .collect::<Vec<_>>(),
        vec!["Going", "Declined", "Waitlisted"],
        "new options are appended, so existing labels do not move"
    );

    {
        let w = world.lock().unwrap();
        assert_eq!(w.tables[0].version, TableVersion(version_before.0 + 1));
        assert_eq!(
            w.published.len(),
            published_before + 1,
            "the schema change is announced for liveness"
        );
    }

    exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name, status) VALUES ('Bo', 'Waitlisted')",
    )
    .await
    .expect("the option now compiles into the CHECK");
}

/// Re-sending a label the column already has changes nothing: no duplicate
/// option, no version bump, no event — and no error either.
#[tokio::test]
async fn adding_an_existing_option_is_a_no_op() {
    let (world, svc, db, guests) = seeded().await;
    let status = column_of_type(&world, guests, DataType::SelectString);
    let version_before = world.lock().unwrap().tables[0].version;
    let published_before = world.lock().unwrap().published.len();

    let column = svc
        .add_column_options(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            AddColumnOptions {
                table_id: guests,
                column_id: status,
                labels: vec!["going".into(), "  Declined  ".into()],
            },
        )
        .await
        .expect("an option that is already there is not an error");

    assert_eq!(column.definition.property_options.len(), 2);
    let w = world.lock().unwrap();
    assert_eq!(w.tables[0].version, version_before);
    assert_eq!(w.published.len(), published_before);
}

#[tokio::test]
async fn options_are_refused_on_a_column_that_cannot_hold_them() {
    let (world, svc, db, guests) = seeded().await;

    let err = try_add_select_column(
        &svc,
        db,
        guests,
        "Notes",
        DataType::String,
        false,
        &["Main"],
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, DatabaseError::InvalidSchemaOperation(ref m) if m.contains("select")),
        "{err:?}"
    );

    // …and the same on the standalone operation, against the text column the
    // seeded table already has.
    let name_column = column_of_type(&world, guests, DataType::String);
    let err = svc
        .add_column_options(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            AddColumnOptions {
                table_id: guests,
                column_id: name_column,
                labels: vec!["Main".into()],
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, DatabaseError::InvalidSchemaOperation(ref m) if m.contains("options")),
        "{err:?}"
    );
}

/// A numeric select stores numbers, so its labels have to be numbers — and
/// the label SQL sees is the normalized one.
#[tokio::test]
async fn numeric_select_options_are_parsed_as_numbers() {
    let (_world, svc, db, guests) = seeded().await;

    let err = try_add_select_column(
        &svc,
        db,
        guests,
        "Priority",
        DataType::SelectNumber,
        false,
        &["soon"],
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, DatabaseError::InvalidSchemaOperation(ref m) if m.contains("not a number")),
        "{err:?}"
    );

    add_select_column(
        &svc,
        db,
        guests,
        "Priority",
        DataType::SelectNumber,
        false,
        &["1", "2.0", "2"],
    )
    .await;
    exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name, priority) VALUES ('Ada', '2')",
    )
    .await
    .expect("`2.0` and `2` are one option, written as `2`");
}

#[tokio::test]
async fn option_labels_are_validated() {
    let (_world, svc, db, guests) = seeded().await;

    for bad in ["   ", ""] {
        let err = try_add_select_column(
            &svc,
            db,
            guests,
            "Stage",
            DataType::SelectString,
            false,
            &[bad],
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, DatabaseError::InvalidSchemaOperation(ref m) if m.contains("empty")),
            "{err:?}"
        );
    }

    let too_long = "x".repeat(MAX_OPTION_LABEL_LEN + 1);
    let err = try_add_select_column(
        &svc,
        db,
        guests,
        "Stage",
        DataType::SelectString,
        false,
        &[&too_long],
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, DatabaseError::InvalidSchemaOperation(ref m) if m.contains("at most")),
        "{err:?}"
    );
}

#[tokio::test]
async fn add_column_options_respects_receipts() {
    let (world, svc, db, guests) = seeded().await;
    let status = column_of_type(&world, guests, DataType::SelectString);
    let elsewhere = Uuid::new_v4();

    let err = svc
        .add_column_options(
            receipt::<EditAccessLevel>(elsewhere, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            AddColumnOptions {
                table_id: guests,
                column_id: status,
                labels: vec!["Waitlisted".into()],
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, DatabaseError::NotFound),
        "a receipt for another database reaches nothing: {err:?}"
    );

    let err = svc
        .add_column_options(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            AddColumnOptions {
                table_id: guests,
                column_id: Uuid::new_v4(),
                labels: vec!["Waitlisted".into()],
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound), "{err:?}");

    // Nothing was written on the way to either refusal.
    assert_eq!(world.lock().unwrap().definitions.len(), 3);
}

#[tokio::test]
async fn lifecycle_and_writes_publish_domain_events() {
    let (world, svc, db, _table) = seeded().await;

    // Seeding created the database and then shaped its table.
    let seeding = broker_event_types(&world);
    assert_eq!(seeding[0], "database.created");
    assert!(
        seeding[1..].iter().all(|t| t == "database.tables_changed"),
        "{seeding:?}"
    );
    world.lock().unwrap().broker_events.clear();

    svc.rename_database(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        "Winter Offsite".into(),
    )
    .await
    .unwrap();
    exec(
        &svc,
        OWNER,
        "UPDATE guests SET status = 'Declined' WHERE name = 'Sam'",
    )
    .await
    .unwrap();
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    assert_eq!(
        broker_event_types(&world),
        [
            "database.renamed",
            "database.tables_changed",
            "database.trashed",
            "database.restored",
            "database.purged",
        ]
    );
    let events = world.lock().unwrap().broker_events.clone();
    let renamed = &events[0]["metadata"];
    assert_eq!(renamed["database_id"], db.to_string());
    assert_eq!(renamed["name"], "Winter Offsite");
    assert_eq!(renamed["attribution"]["actor"], OWNER);
    let changed = &events[1]["metadata"];
    assert_eq!(changed["database_id"], db.to_string());
    assert_eq!(changed["attribution"]["actor"], OWNER);
    assert_eq!(changed["tables"].as_array().map(Vec::len), Some(1));
    assert_eq!(events[4]["metadata"]["database_id"], db.to_string());
}

#[tokio::test]
async fn no_op_lifecycle_calls_publish_nothing() {
    let (world, svc, db, _table) = seeded().await;
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    world.lock().unwrap().broker_events.clear();

    // Trashing twice and restoring what is not trashed change nothing, so
    // nothing is announced.
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(broker_event_types(&world), ["database.restored"]);
}
