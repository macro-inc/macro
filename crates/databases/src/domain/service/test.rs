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
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::PropertyOwner;
use models_properties::shared::{DataType, EntityType as PropertyEntityType};
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    AppliedChanges, Column, ColumnBinding, PropertyDefinitionId, RowChange, SqlValue, TableVersion,
};
use crate::outbound::rusqlite_executor::{ExecutorLimits, RusqliteExecutor};

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
    applied: Vec<RowChange>,
}

type Shared = Arc<Mutex<World>>;

#[derive(Clone)]
struct FakeRepo(Shared);
#[derive(Clone)]
struct FakeDefs(Shared);
#[derive(Clone)]
struct FakeMagic;
#[derive(Clone)]
struct FakeEvents(Shared);
#[derive(Clone)]
struct FakeAccess(Shared);

impl DatabasesRepo for FakeRepo {
    type Err = FakeError;
    async fn create_database(&self, cmd: &CreateDatabase) -> Result<Database, FakeError> {
        let database = Database {
            id: Uuid::new_v4(),
            name: cmd.name.clone(),
            owner_id: cmd.owner_id.as_ref().to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        };
        self.0.lock().unwrap().databases.push(database.clone());
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
    async fn create_table(&self, cmd: &CreateTable) -> Result<Table, FakeError> {
        let mut w = self.0.lock().unwrap();
        let table = Table {
            id: Uuid::new_v4(),
            database_id: cmd.database_id,
            name: cmd.name.clone(),
            position: format!("{:04}", w.tables.len()),
            version: TableVersion(0),
        };
        w.tables.push(table.clone());
        Ok(table)
    }
    async fn create_column(
        &self,
        table_id: TableId,
        property_definition_id: PropertyDefinitionId,
        cmd: &CreateColumn,
    ) -> Result<ColumnId, FakeError> {
        let mut w = self.0.lock().unwrap();
        let column = Column {
            id: Uuid::new_v4(),
            table_id,
            property_definition_id,
            position: format!("{:04}", w.columns.len()),
            config: cmd.config.clone(),
        };
        w.columns.push(column.clone());
        Ok(column.id)
    }
    async fn fetch_rows(&self, table_id: TableId) -> Result<Vec<Row>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .rows
            .get(&table_id)
            .cloned()
            .unwrap_or_default())
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
    ) -> Result<AppliedChanges, FakeError> {
        let mut w = self.0.lock().unwrap();
        let mut minted = Vec::new();
        let mut versions = HashMap::new();
        for change in changes {
            w.applied.push(change.clone());
            match change {
                RowChange::Insert { table_id, cells } => {
                    let id = Uuid::new_v4();
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
                    versions.insert(*table_id, TableVersion(1));
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
                    versions.insert(*table_id, TableVersion(1));
                }
                RowChange::Delete { table_id, row_id } => {
                    if let Some(rows) = w.rows.get_mut(table_id) {
                        rows.retain(|r| r.id != *row_id);
                    }
                    versions.insert(*table_id, TableVersion(1));
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
        Ok((minted, versions))
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
    async fn resolve_option(
        &self,
        _definition_id: PropertyDefinitionId,
        _display_value: &str,
    ) -> Result<Option<Uuid>, FakeError> {
        Ok(None)
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
        }]
    }
    async fn materialize(
        &self,
        viewer: &Viewer,
        sql_name: &str,
        _columns: &[String],
    ) -> Result<MaterializedTable, FakeError> {
        assert_eq!(sql_name, "people");
        Ok(MaterializedTable {
            schema: self.schemas().remove(0),
            rows: vec![vec![
                SqlValue::Text(viewer.user_id.as_ref().to_string()),
                SqlValue::Text("me@macro.com".into()),
            ]],
        })
    }
}

impl TableEventPublisher for FakeEvents {
    type Err = FakeError;
    async fn table_changed(
        &self,
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
    async fn grant_owner(
        &self,
        database_id: DatabaseId,
        owner: &MacroUserIdStr<'_>,
    ) -> Result<(), FakeError> {
        self.0
            .lock()
            .unwrap()
            .grants
            .entry(owner.as_ref().to_string())
            .or_default()
            .push((database_id, AccessGrant::Owner));
        Ok(())
    }
}

type Service =
    DatabasesServiceImpl<FakeRepo, FakeDefs, FakeMagic, RusqliteExecutor, FakeEvents, FakeAccess>;

fn service(world: &Shared) -> Service {
    DatabasesServiceImpl::new(
        FakeRepo(world.clone()),
        FakeDefs(world.clone()),
        FakeMagic,
        RusqliteExecutor::new(ExecutorLimits::default()),
        FakeEvents(world.clone()),
        FakeAccess(world.clone()),
    )
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
            CreateColumn {
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "Name".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
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
            CreateColumn {
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "Status".into(),
                    data_type: DataType::SelectString,
                    is_multi_select: false,
                },
                config: None,
            },
        )
        .await
        .unwrap();
    svc.create_column(
        rec,
        CreateColumn {
            table_id,
            binding: ColumnBinding::NewDefinition {
                name: "Plus ones".into(),
                data_type: DataType::Number,
                is_multi_select: false,
            },
            config: None,
        },
    )
    .await
    .unwrap();
    // Give Status two options and share View-only with VIEWER.
    {
        let mut w = world.lock().unwrap();
        let def_id = w
            .columns
            .iter()
            .find(|c| c.id == status_col)
            .unwrap()
            .property_definition_id;
        let def = w.definitions.get_mut(&def_id).unwrap();
        def.property_options = ["Going", "Declined"]
            .iter()
            .enumerate()
            .map(|(i, v)| PropertyOption {
                id: Uuid::new_v4(),
                property_definition_id: def_id,
                display_order: i as i32,
                value: PropertyOptionValue::String(v.to_string()),
                color: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            })
            .collect();
        w.grants
            .entry(VIEWER.into())
            .or_default()
            .push((database.id, AccessGrant::View));
    }
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
            self.entity_permission().clone(),
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
    let w = world.lock().unwrap();
    assert_eq!(w.tables.len(), 1);
    assert_eq!(w.tables[0].name, "Table 1");

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
            CreateColumn {
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "X".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
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
