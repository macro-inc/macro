//! Toolset tests over a fake service and entity access: receipts gate the
//! schema operations and errors reach the model in a form it can act on.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ai_toolset::schema::generate_validated_input_schema;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use chrono::Utc;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity as AccessEntity,
    EntityAccessReceipt, EntityPermission, EntityType as AccessEntityType, OwnerAccessLevel,
    RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;
use models_databases::position::Position;
use models_databases::{ColumnId, DatabaseId, TableId, ViewId};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::{DataType, PropertyOwner};
use uuid::Uuid;

use super::*;
mod committed_writes;
mod options;
mod receipts;
mod relations;
mod rendering;
mod schema_changes;
mod schemas;
mod views;
mod write_warning;
use crate::domain::models::{Column, ColumnDetail, Database, Table, TableDetail, TableVersion};

const USER: &str = "macro|wolf@macro.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).expect("valid user id")
}

fn request_context() -> RequestContext {
    RequestContext::new(user())
}

/// What the fake service was asked to do, so a test can assert a denied call
/// never reached it.
#[derive(Debug, Default, PartialEq)]
struct Calls {
    listed: usize,
    described: usize,
    created_databases: Vec<String>,
    renamed_databases: Vec<String>,
    /// The agent each attributed write reached the service as.
    acting_bots: Vec<Option<BotId>>,
    /// Every batch of ops the service was asked to apply.
    applied: Vec<OpBatch>,
}

#[derive(Clone, Default)]
struct FakeService {
    calls: Arc<Mutex<Calls>>,
    /// Fail only the post-write schema enrichment.
    schema_error: bool,
    multi_select_group: bool,
    /// The described table's views.
    views: Vec<crate::domain::models::DatabaseView>,
}

const DATABASE_ID: DatabaseId =
    DatabaseId::from_uuid(Uuid::from_u128(0x0dbb_0000_0000_0000_0000_0000_0000_0001));
const TABLE_ID: TableId =
    TableId::from_uuid(Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0001));
const COLUMN_ID: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0xc01a_0000_0000_0000_0000_0000_0000_0001));
const VIEW_ID: ViewId =
    ViewId::from_uuid(Uuid::from_u128(0x71e0_0000_0000_0000_0000_0000_0000_0001));

fn database() -> Database {
    Database {
        id: DATABASE_ID,
        name: "Offsite".to_string(),
        owner_id: USER.to_string(),
        created_at: Utc::now(),
        trashed_at: None,
    }
}

fn table() -> Table {
    Table {
        id: TABLE_ID,
        database_id: DATABASE_ID,
        name: "Guests".to_string(),
        position: "80".parse().unwrap(),
        version: TableVersion(3),
    }
}

/// A select column with two options, which is what exercises option rendering.
fn status_column() -> ColumnDetail {
    ColumnDetail {
        column: Column {
            infer_type: false,
            display_name: None,
            id: COLUMN_ID,
            table_id: TABLE_ID,
            property_definition_id: Uuid::nil(),
            position: "80".parse().unwrap(),
            config: None,
        },
        sql_name: "\"Status\"".to_string(),
        definition: PropertyDefinitionWithOptions {
            definition: PropertyDefinition {
                id: Uuid::nil(),
                owner: PropertyOwner::Database {
                    database_id: DATABASE_ID.into_uuid(),
                },
                display_name: "Status".to_string(),
                data_type: DataType::SelectString,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                is_system: false,
                is_metadata: false,
            },
            property_options: vec![option("Going", 0), option("Declined", 1)],
        },
        writable: true,
        shared_outside_database: false,
    }
}

fn option(label: &str, display_order: i32) -> PropertyOption {
    PropertyOption {
        id: Uuid::new_v4(),
        property_definition_id: Uuid::nil(),
        display_order,
        value: PropertyOptionValue::String(label.to_string()),
        color: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn detail(grant: AccessLevel) -> DatabaseDetail {
    DatabaseDetail {
        database: database(),
        grant,
        tables: vec![TableDetail {
            table: table(),
            sql_name: "\"Offsite\".\"Guests\"".to_string(),
            columns: vec![status_column()],
            views: vec![],
        }],
    }
}

impl DatabasesService for FakeService {
    async fn create_database(
        &self,
        command: crate::domain::models::CreateDatabase,
    ) -> Result<Database, DatabaseError> {
        let mut calls = self.calls.lock().unwrap();
        calls.created_databases.push(command.name);
        calls.acting_bots.push(command.acting_bot);
        Ok(database())
    }

    async fn list_databases(&self, _viewer: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        self.calls.lock().unwrap().listed += 1;
        Ok(vec![ListedDatabase {
            database: database(),
            grant: AccessLevel::Owner,
            tables: vec![table()],
        }])
    }

    async fn database_details(
        &self,
        _viewer: Viewer,
    ) -> Result<Vec<DatabaseDetail>, DatabaseError> {
        unimplemented!("no tool reads every database in detail")
    }

    async fn share_awareness(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
        _state: crate::domain::models::Awareness,
    ) -> Result<(), DatabaseError> {
        unimplemented!("the toolset does not share awareness")
    }

    async fn column_conversion(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: TableId,
        _column_id: ColumnId,
        _to: models_databases::ColumnKind,
    ) -> Result<crate::domain::models::ColumnConversion, DatabaseError> {
        unimplemented!("no tool converts a column into a new one")
    }

    async fn apply_ops_with_changes(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: crate::domain::models::Viewer,
        _batch: crate::domain::models::OpBatch,
    ) -> Result<crate::domain::models::AppliedOps, DatabaseError> {
        unimplemented!("the toolset does not undo")
    }

    async fn undo_change(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: crate::domain::models::Viewer,
        _change: crate::domain::models::ChangeId,
    ) -> Result<crate::domain::journal::UndoOutcome, DatabaseError> {
        unimplemented!("the toolset does not undo")
    }

    async fn table_changes(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: crate::domain::models::TableId,
        _since: crate::domain::models::TableVersion,
    ) -> Result<crate::domain::journal::TableChanges, DatabaseError> {
        unimplemented!("the toolset reads no table changes")
    }

    async fn row_history(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: crate::domain::models::TableId,
        _row_id: crate::domain::models::RowId,
    ) -> Result<Vec<crate::domain::journal::RowHistoryEntry>, DatabaseError> {
        unimplemented!("the toolset reads no history")
    }

    async fn view_positions(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _view_id: crate::domain::models::ViewId,
    ) -> Result<Vec<crate::domain::models::CardPosition>, DatabaseError> {
        unimplemented!("the toolset does not read card places")
    }

    /// Answers each op as the service would, every touched table moving to
    /// version 4; a view op answers the view it would leave, as of a fixed
    /// time.
    async fn apply_ops(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<Vec<OpResult>, DatabaseError> {
        use models_databases::{
            ColumnChange, ColumnResult, DatabaseOp, TableChange, TableResult, VersionedTable,
            ViewChange, ViewResult,
        };
        {
            let mut calls = self.calls.lock().unwrap();
            calls.applied.push(batch.clone());
            calls.acting_bots.push(viewer.acting_bot);
        }
        let at = chrono::DateTime::UNIX_EPOCH;
        let table_version = TableVersion(4);
        Ok(batch
            .ops
            .into_iter()
            .map(|op| match op {
                DatabaseOp::Table { table, change } => {
                    let (table_version, change) = match change {
                        TableChange::Create { .. } => (Some(TableVersion(1)), TableResult::Created),
                        TableChange::Rename { .. } => (Some(table_version), TableResult::Renamed),
                        TableChange::Delete => (None, TableResult::Deleted),
                        TableChange::ReorderColumns { .. } => {
                            (Some(table_version), TableResult::ColumnsReordered)
                        }
                        other => unimplemented!("the toolset sends no {other:?}"),
                    };
                    OpResult::Table {
                        table,
                        table_version,
                        change,
                    }
                }
                DatabaseOp::ReorderTables { order } => OpResult::ReorderTables {
                    tables: order
                        .into_iter()
                        .map(|table| VersionedTable {
                            table,
                            version: table_version,
                        })
                        .collect(),
                },
                DatabaseOp::Column {
                    table,
                    column,
                    change,
                } => OpResult::Column {
                    table,
                    column,
                    table_version,
                    change: match change {
                        ColumnChange::Create { .. } => ColumnResult::Created,
                        ColumnChange::Rename { .. } => ColumnResult::Renamed,
                        ColumnChange::Delete => ColumnResult::Deleted,
                        ColumnChange::AddOptions { options } => ColumnResult::OptionsAdded {
                            added: options.into_iter().map(|option| option.id).collect(),
                        },
                        ColumnChange::ChangeType { .. } => ColumnResult::TypeChanged,
                        other => unimplemented!("the toolset sends no {other:?}"),
                    },
                },
                DatabaseOp::View {
                    table,
                    view: id,
                    change: ViewChange::Create { view },
                } => OpResult::View {
                    table,
                    view: id,
                    table_version,
                    change: ViewResult::Created {
                        view: Box::new(crate::domain::models::DatabaseView {
                            id,
                            database_id: DATABASE_ID,
                            table_id: table,
                            name: view.name,
                            position: "80".parse::<Position>().unwrap(),
                            query: view.query,
                            layout: view
                                .layout
                                .with_default_title(Some(COLUMN_ID))
                                .expect("a title to default to"),
                            created_at: at,
                            updated_at: at,
                        }),
                    },
                },
                DatabaseOp::View {
                    table,
                    view,
                    change:
                        ViewChange::Update {
                            name,
                            query,
                            layout,
                        },
                } => {
                    let current = self
                        .views
                        .iter()
                        .find(|stored| stored.id == view)
                        .expect("the view the tool found")
                        .clone();
                    OpResult::View {
                        table,
                        view,
                        table_version,
                        change: ViewResult::Updated {
                            view: Box::new(crate::domain::models::DatabaseView {
                                name: name.unwrap_or(current.name),
                                query: query.unwrap_or(current.query),
                                layout: layout
                                    .and_then(|layout| layout.with_default_title(Some(COLUMN_ID)))
                                    .unwrap_or(current.layout),
                                ..current
                            }),
                        },
                    }
                }
                DatabaseOp::View {
                    table,
                    view,
                    change: ViewChange::Delete,
                } => OpResult::View {
                    table,
                    view,
                    table_version,
                    change: ViewResult::Deleted,
                },
                other => unimplemented!("the toolset sends no {other:?}"),
            })
            .collect())
    }

    /// The fixed database, its Status column holding the options every
    /// applied batch added to it.
    async fn get_database(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DatabaseDetail, DatabaseError> {
        let mut calls = self.calls.lock().unwrap();
        calls.described += 1;
        if self.schema_error {
            return Err(DatabaseError::Repo(
                rootcause::Report::new(std::io::Error::other("schema connection lost"))
                    .into_dynamic(),
            ));
        }
        let mut database = detail(AccessLevel::Owner);
        let status = &mut database.tables[0].columns[0].definition;
        status.definition.is_multi_select = self.multi_select_group;
        let added = calls
            .applied
            .iter()
            .flat_map(|batch| &batch.ops)
            .filter_map(|op| match op {
                models_databases::DatabaseOp::Column {
                    column,
                    change: models_databases::ColumnChange::AddOptions { options },
                    ..
                } if *column == COLUMN_ID => Some(options),
                _ => None,
            })
            .flatten();
        for (offset, added) in added.enumerate() {
            status
                .property_options
                .push(option(&added.label, 2 + offset as i32));
        }
        database.tables[0].views = self.views.clone();
        Ok(database)
    }

    async fn rename_database(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> Result<Database, DatabaseError> {
        let mut calls = self.calls.lock().unwrap();
        calls.renamed_databases.push(name.clone());
        calls.acting_bots.push(match receipt.auth() {
            entity_access::domain::models::EntityAccessAuth::Bot(bot) => Some(bot.bot_id()),
            _ => None,
        });
        Ok(Database { name, ..database() })
    }

    async fn infer_column_type(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: crate::domain::models::InferColumnType,
    ) -> Result<crate::domain::models::InferColumnTypeOutcome, DatabaseError> {
        unimplemented!("tool tests do not infer column types")
    }

    async fn column_casts(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: TableId,
        _: ColumnId,
    ) -> Result<Vec<crate::domain::models::ColumnCast>, DatabaseError> {
        unimplemented!("tool tests do not preview type changes")
    }

    async fn trash_database(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("the toolset does not trash databases")
    }

    async fn restore_database(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("the toolset does not restore databases")
    }

    async fn delete_database_permanently(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("the toolset does not delete databases")
    }

    async fn save_query(
        &self,
        _viewer: Viewer,
        _database_id: Option<crate::domain::models::DatabaseId>,
        _definition: crate::domain::models::QueryDefinition,
    ) -> Result<crate::domain::models::SavedQuery, crate::domain::models::SavedQueryError> {
        unimplemented!("no tool saves a query")
    }

    async fn get_query(
        &self,
        _viewer: Viewer,
        _id: crate::domain::models::QueryId,
    ) -> Result<crate::domain::models::SavedQuery, crate::domain::models::SavedQueryError> {
        unimplemented!("no tool reads a saved query back")
    }
}

/// Grants exactly `level`, or nothing at all when `level` is `None`.
#[derive(Clone)]
struct FakeAccess {
    level: Option<AccessLevel>,
}

impl FakeAccess {
    fn granting(level: AccessLevel) -> Arc<Self> {
        Arc::new(Self { level: Some(level) })
    }

    fn denying() -> Arc<Self> {
        Arc::new(Self { level: None })
    }
}

impl EntityAccessService for FakeAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: AccessEntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let Some(access_level) = self.level else {
            return Err(AccessError::Unauthorized);
        };
        EntityAccessReceipt::try_new_authenticated_user(
            user(),
            AccessEntity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel { access_level },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: AccessEntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let Some(access_level) = self.level else {
            return Err(AccessError::Unauthorized);
        };
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            AccessEntity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel { access_level },
        )
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(self.level)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        self.level.ok_or(AccessError::Unauthorized)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: AccessEntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        self.level
            .map(|access_level| EntityPermission::AccessLevel { access_level })
            .ok_or(AccessError::Unauthorized)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("databases tools never touch CRM entities")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(vec![user()])
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Ok(None)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Ok(None)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(None)
    }
}

type Context = DatabasesToolContext<FakeService, FakeAccess>;

fn context(access: Arc<FakeAccess>) -> (Context, Arc<Mutex<Calls>>) {
    let service = FakeService::default();
    let calls = service.calls.clone();
    (DatabasesToolContext::new(service, access), calls)
}
