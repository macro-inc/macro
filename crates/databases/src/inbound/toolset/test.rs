//! Toolset tests: fake service + fake entity access, asserting that the
//! receipts gate the schema operations, that SQL runs without one, and that
//! errors reach the model in a form it can act on.

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
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::{DataType, PropertyOwner};
use uuid::Uuid;

use super::*;
mod committed_writes;
mod read_only;
mod relations;
mod saved_views;
use crate::domain::models::{
    Column, ColumnDetail, Database, ExecOutcome, QueryResult, RenameColumnOutcome, ResultColumn,
    SqlValue, SqliteSnapshot, Table, TableDetail, TableVersion,
};
use saved_views::FakeViews;

const USER: &str = "macro|wolf@macro.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).expect("valid user id")
}

fn request_context() -> RequestContext {
    RequestContext::new(user())
}

// --- fakes ---

/// What the fake service was asked to do, so a test can assert a denied call
/// never reached it.
#[derive(Debug, Default, PartialEq)]
struct Calls {
    listed: usize,
    described: usize,
    executed: Vec<String>,
    queried: Vec<String>,
    base_versions: Vec<Option<HashMap<Uuid, TableVersion>>>,
    created_databases: Vec<String>,
    created_tables: Vec<String>,
    created_columns: Vec<(Uuid, DataType, bool, Vec<String>)>,
    added_options: Vec<(Uuid, Vec<String>)>,
}

#[derive(Clone, Default)]
struct FakeService {
    calls: Arc<Mutex<Calls>>,
    /// When set, `exec_sql` fails with this SQLite message instead of running.
    sql_error: Option<String>,
    /// Fail only the post-write schema enrichment.
    schema_error: bool,
}

const DATABASE_ID: Uuid = Uuid::from_u128(0x0dbb_0000_0000_0000_0000_0000_0000_0001);
const TABLE_ID: Uuid = Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0001);
const COLUMN_ID: Uuid = Uuid::from_u128(0xc01a_0000_0000_0000_0000_0000_0000_0001);

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
        position: "a".to_string(),
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
            position: "a".to_string(),
            config: None,
        },
        sql_name: "status".to_string(),
        definition: PropertyDefinitionWithOptions {
            definition: PropertyDefinition {
                id: Uuid::nil(),
                owner: PropertyOwner::Database {
                    database_id: DATABASE_ID,
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
        junction_sql_name: None,
        read_junction_sql_name: None,
        junction_writable: false,
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

fn detail(grant: AccessGrant) -> DatabaseDetail {
    DatabaseDetail {
        database: database(),
        grant,
        tables: vec![TableDetail {
            table: table(),
            sql_name: "guests".to_string(),
            read_sql_name: crate::domain::catalog::read_table_name(table().id),
            columns: vec![status_column()],
        }],
    }
}

impl DatabasesService for FakeService {
    async fn create_database(
        &self,
        cmd: crate::domain::models::CreateDatabase,
    ) -> Result<Database, DatabaseError> {
        self.calls.lock().unwrap().created_databases.push(cmd.name);
        Ok(database())
    }

    async fn list_databases(&self, _viewer: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        self.calls.lock().unwrap().listed += 1;
        Ok(vec![ListedDatabase {
            database: database(),
            grant: AccessGrant::Owner,
            tables: vec![table()],
        }])
    }

    async fn get_database(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
    ) -> Result<DatabaseDetail, DatabaseError> {
        self.calls.lock().unwrap().described += 1;
        if self.schema_error {
            return Err(DatabaseError::Repo(
                rootcause::Report::new(std::io::Error::other("schema connection lost"))
                    .into_dynamic(),
            ));
        }
        Ok(detail(AccessGrant::Owner))
    }

    // Renaming and the trash have no tools: the model has no use case for
    // them that a user would not do themselves, and a permanent delete is not
    // something a tool call should be able to reach.
    async fn rename_database(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _name: String,
    ) -> Result<Database, DatabaseError> {
        unimplemented!("the toolset does not rename databases")
    }

    async fn rename_table(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _table_id: crate::domain::models::TableId,
        _name: String,
        _previous_name: String,
    ) -> Result<Table, DatabaseError> {
        unimplemented!("the toolset does not rename tables")
    }

    async fn infer_column_type(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: Viewer,
        _: crate::domain::models::InferColumnType,
    ) -> Result<crate::domain::models::InferColumnTypeOutcome, DatabaseError> {
        unimplemented!("tool tests do not infer column types")
    }
    async fn rename_column(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _table_id: crate::domain::models::TableId,
        _column_id: crate::domain::models::ColumnId,
        _name: String,
        _previous_name: String,
    ) -> Result<RenameColumnOutcome, DatabaseError> {
        unimplemented!("the toolset does not rename columns")
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

    async fn create_table(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: crate::domain::models::CreateTable,
    ) -> Result<Table, DatabaseError> {
        self.calls.lock().unwrap().created_tables.push(cmd.name);
        Ok(table())
    }

    async fn create_column(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: Viewer,
        cmd: crate::domain::models::CreateColumn,
    ) -> Result<crate::domain::models::ColumnId, DatabaseError> {
        let crate::domain::models::ColumnBinding::NewDefinition {
            data_type,
            is_multi_select,
            options,
            ..
        } = cmd.binding
        else {
            panic!("the tool only ever creates fresh definitions");
        };
        self.calls.lock().unwrap().created_columns.push((
            cmd.table_id,
            data_type,
            is_multi_select,
            options,
        ));
        Ok(COLUMN_ID)
    }

    async fn add_column_options(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: Viewer,
        cmd: crate::domain::models::AddColumnOptions,
    ) -> Result<ColumnDetail, DatabaseError> {
        self.calls
            .lock()
            .unwrap()
            .added_options
            .push((cmd.column_id, cmd.labels.clone()));
        let mut column = status_column();
        for (offset, label) in cmd.labels.iter().enumerate() {
            column
                .definition
                .property_options
                .push(option(label, 2 + offset as i32));
        }
        Ok(column)
    }

    async fn exec_sql(
        &self,
        _viewer: Viewer,
        req: crate::domain::models::ExecRequest,
    ) -> Result<ExecOutcome, QueryError> {
        self.calls.lock().unwrap().executed.push(req.sql);
        self.calls
            .lock()
            .unwrap()
            .base_versions
            .push(req.base_versions);
        if let Some(message) = &self.sql_error {
            return Err(QueryError::Sql(message.clone()));
        }
        Ok(ExecOutcome {
            results: vec![QueryResult {
                columns: vec![ResultColumn {
                    name: "id".to_string(),
                    entity_type: Some(EntityType::User),
                    origin: None,
                }],
                rows: vec![vec![SqlValue::Text("usr_1".to_string())]],
            }],
            changes_applied: 2,
            inserted_row_ids: vec![Uuid::nil()],
            new_versions: std::collections::HashMap::from([(TABLE_ID, TableVersion(4))]),
            read_tables: vec![TABLE_ID],
            read_database_ids: vec![DATABASE_ID],
            read_versions: std::collections::HashMap::from([(TABLE_ID, TableVersion(3))]),
            truncated_tables: Vec::new(),
        })
    }

    async fn query_sql(&self, _viewer: Viewer, sql: String) -> Result<ExecOutcome, QueryError> {
        self.calls.lock().unwrap().queried.push(sql);
        if let Some(message) = &self.sql_error {
            return Err(QueryError::ReadOnly(message.clone()));
        }
        Ok(ExecOutcome {
            results: vec![QueryResult {
                columns: vec![ResultColumn {
                    name: "count".into(),
                    entity_type: None,
                    origin: None,
                }],
                rows: vec![vec![SqlValue::Integer(12)]],
            }],
            changes_applied: 0,
            inserted_row_ids: vec![],
            new_versions: HashMap::new(),
            read_tables: vec![TABLE_ID],
            read_database_ids: vec![DATABASE_ID],
            read_versions: HashMap::from([(TABLE_ID, TableVersion(3))]),
            truncated_tables: vec![],
        })
    }

    async fn sqlite_snapshot(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
    ) -> Result<SqliteSnapshot, QueryError> {
        unimplemented!("the toolset does not expose snapshots")
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
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("databases tools never act as a bot")
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
    (
        DatabasesToolContext::new(service, access, FakeViews::default()),
        calls,
    )
}

fn failing_sql_context(message: &str) -> Context {
    DatabasesToolContext::new(
        FakeService {
            sql_error: Some(message.to_string()),
            ..FakeService::default()
        },
        FakeAccess::granting(AccessLevel::Owner),
        FakeViews::default(),
    )
}

// --- schema validation ---

#[test]
fn every_tool_schema_is_valid() {
    assert_eq!(
        generate_validated_input_schema::<SaveDatabaseView>()
            .expect("view schema validates")
            .name,
        "SaveDatabaseView"
    );
    assert_eq!(
        generate_validated_input_schema::<ListDatabases>()
            .expect("schema should validate")
            .name,
        "ListDatabases"
    );
    assert_eq!(
        generate_validated_input_schema::<DescribeDatabase>()
            .expect("schema should validate")
            .name,
        "DescribeDatabase"
    );
    assert_eq!(
        generate_validated_input_schema::<CreateDatabase>()
            .expect("schema should validate")
            .name,
        "CreateDatabase"
    );
    assert_eq!(
        generate_validated_input_schema::<CreateTable>()
            .expect("schema should validate")
            .name,
        "CreateTable"
    );
    assert_eq!(
        generate_validated_input_schema::<AddColumn>()
            .expect("schema should validate")
            .name,
        "AddColumn"
    );
    assert_eq!(
        generate_validated_input_schema::<AddColumnOptions>()
            .expect("schema should validate")
            .name,
        "AddColumnOptions"
    );
}

/// The dialect note is the whole reason a model can write correct SQL on the
/// first try, so it has to actually reach the description.
#[test]
fn query_schema_teaches_the_dialect() {
    let validated =
        generate_validated_input_schema::<QueryDatabase>().expect("schema should validate");
    assert_eq!(validated.name, "QueryDatabase");
    for expected in ["row_id", "HAS", "DescribeDatabase", "people"] {
        assert!(
            validated.description.contains(expected),
            "description is missing {expected}: {}",
            validated.description
        );
    }
}

/// Every tool has to survive being put in a collection — that is where name
/// conflicts and schema rejections actually surface.
#[test]
fn toolset_builds_with_every_tool() {
    let toolset = databases_toolset::<FakeService, FakeAccess>();

    for name in [
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "CreateDatabase",
        "CreateTable",
        "AddColumn",
        "AddColumnOptions",
        "SaveDatabaseView",
    ] {
        assert!(toolset.tools.contains_key(name), "missing {name}");
    }
    assert_eq!(toolset.tools.len(), 8);
    assert!(
        toolset.user_tools.is_empty(),
        "database tools run in the loop, none are user-executed"
    );
}

// --- receipts gate the schema operations ---

#[tokio::test]
async fn describe_needs_a_view_receipt() {
    let (context, calls) = context(FakeAccess::denying());
    let error = DescribeDatabase {
        database_id: DATABASE_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("no access means no schema");

    assert!(
        error
            .description
            .contains("does not have permission to read"),
        "{}",
        error.description
    );
    assert_eq!(
        calls.lock().unwrap().described,
        0,
        "the service must not be reached without a receipt"
    );
}

/// View access reads; it does not create tables. The receipt type is what
/// draws that line, and it is drawn before the service is touched.
#[tokio::test]
async fn creating_a_table_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = CreateTable {
        database_id: DATABASE_ID,
        name: "Sessions".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot change the schema");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().created_tables.is_empty());
}

#[tokio::test]
async fn creating_a_table_with_edit_access_succeeds() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = CreateTable {
        database_id: DATABASE_ID,
        name: "Sessions".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may add a tab");

    assert_eq!(response.table_id, TABLE_ID);
    assert_eq!(calls.lock().unwrap().created_tables, vec!["Sessions"]);
    assert_eq!(
        response.database.expect("schema refresh succeeds").tables[0].sql_name,
        "guests",
        "the SQL name comes from the catalog, not from the display name"
    );
}

#[tokio::test]
async fn adding_a_column_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Dietary Needs".to_string(),
        data_type: ColumnType::Select,
        is_multi_select: true,
        options: Some(vec!["Vegan".to_string()]),
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot change the schema");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().created_columns.is_empty());
}

/// The tool's vocabulary has to reach the property system unchanged, or a
/// column is created as one type and read back as another.
#[tokio::test]
async fn adding_a_column_passes_the_type_through() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Dietary Needs".to_string(),
        data_type: ColumnType::Select,
        is_multi_select: true,
        options: Some(vec!["Vegan".to_string(), "Gluten-free".to_string()]),
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may add a column");

    assert_eq!(response.column_id, COLUMN_ID);
    assert_eq!(
        calls.lock().unwrap().created_columns,
        vec![(
            TABLE_ID,
            DataType::SelectString,
            true,
            vec!["Vegan".to_string(), "Gluten-free".to_string()]
        )]
    );
}

#[test]
fn column_types_round_trip_through_the_property_system() {
    for column_type in [
        ColumnType::Text,
        ColumnType::Number,
        ColumnType::Boolean,
        ColumnType::Date,
        ColumnType::Link,
        ColumnType::Select,
        ColumnType::SelectNumber,
        ColumnType::Tag,
        ColumnType::Entity,
    ] {
        let stored: DataType = column_type.into();
        assert_eq!(
            ColumnType::from(stored),
            column_type,
            "{column_type:?} did not round trip"
        );
    }
}

// --- SQL needs no receipt, because the catalog is the authorization ---

/// `exec_sql` is scoped by the viewer's catalog, not by an entity receipt, so
/// it must run even when no single database can be proved — that is how a
/// query spanning several databases works at all.
#[tokio::test]
async fn querying_does_not_mint_a_receipt() {
    let (context, calls) = context(FakeAccess::denying());
    let response = QueryDatabase {
        sql: "SELECT row_id FROM guests".to_string(),
        base_versions: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("SQL is authorized by the catalog, not by a receipt");

    assert_eq!(
        calls.lock().unwrap().executed,
        vec!["SELECT row_id FROM guests"]
    );
    assert_eq!(response.changes_applied, 2);
    assert_eq!(response.new_versions.get(&TABLE_ID), Some(&4));
    assert_eq!(response.read_versions[0].table_id, TABLE_ID);
    assert_eq!(response.read_versions[0].version, 3);
    assert_eq!(calls.lock().unwrap().base_versions, vec![None]);
    assert_eq!(
        response.results[0].columns[0].entity_type.as_deref(),
        Some("user"),
        "entity provenance survives so the UI can render a chip"
    );
    assert!(response.summary.contains("Applied 2 row changes"));
}

#[tokio::test]
async fn conditional_tool_edits_forward_only_explicit_read_versions() {
    let (context, calls) = context(FakeAccess::denying());
    let request: QueryDatabase = serde_json::from_value(serde_json::json!({
        "sql": "UPDATE guests SET status = 'Going' WHERE row_id = 'record'",
        "baseVersions": [{"tableId": TABLE_ID, "version": 3}],
    }))
    .unwrap();
    request
        .call(ServiceContext(context), request_context())
        .await
        .unwrap();
    assert_eq!(
        calls.lock().unwrap().base_versions,
        vec![Some(HashMap::from([(TABLE_ID, TableVersion(3))]))]
    );
    let legacy: QueryDatabase =
        serde_json::from_value(serde_json::json!({"sql":"SELECT 1"})).unwrap();
    assert!(legacy.base_versions.is_none());
}

/// SQLite's message is the product's broken-query state: it is what lets a
/// model fix the name and retry, so it has to arrive verbatim.
#[tokio::test]
async fn a_sql_error_reaches_the_model_verbatim() {
    let error = QueryDatabase {
        sql: "SELECT statuz FROM guests".to_string(),
        base_versions: None,
    }
    .call(
        ServiceContext(failing_sql_context("no such column: statuz")),
        request_context(),
    )
    .await
    .expect_err("a bad statement is an error");

    assert!(
        error.description.contains("no such column: statuz"),
        "{}",
        error.description
    );
    assert!(
        error.description.contains("DescribeDatabase"),
        "the error should say how to recover: {}",
        error.description
    );
}

#[test]
fn a_read_only_table_says_why() {
    let error = query_error(QueryError::ReadOnly("table people is read-only".into()));
    assert!(
        error.description.contains("magic table"),
        "{}",
        error.description
    );
}

// --- rendering ---

#[tokio::test]
async fn listing_renders_the_grant() {
    let (context, _) = context(FakeAccess::granting(AccessLevel::Owner));
    let response = ListDatabases {}
        .call(ServiceContext(context), request_context())
        .await
        .expect("listing needs no receipt");

    assert_eq!(response.databases.len(), 1);
    assert_eq!(response.databases[0].grant, ToolGrant::Owner);
    assert_eq!(response.databases[0].name, "Offsite");
    assert_eq!(response.databases[0].tables[0].name, "Guests");
    assert_eq!(response.databases[0].tables[0].id, TABLE_ID);
    assert_eq!(
        response.databases[0].tables[0].read_sql_name,
        crate::domain::catalog::read_table_name(TABLE_ID)
    );
    assert_eq!(response.summary, "Found 1 database.");
}

#[test]
fn an_empty_list_says_so_rather_than_looking_like_a_failure() {
    assert!(list_databases::summarize(&[]).contains("No accessible databases"));
}

/// Select options reach the model as the labels SQL accepts, not as the option
/// ids they are stored under — writing an id would be rejected.
#[test]
fn describing_a_database_renders_option_labels() {
    let schema = ToolDatabaseSchema::from(detail(AccessGrant::Owner));

    assert_eq!(schema.tables[0].sql_name, "guests");
    assert_eq!(
        schema.tables[0].read_sql_name,
        crate::domain::catalog::read_table_name(TABLE_ID)
    );
    assert_eq!(schema.tables[0].version, 3);
    assert!(schema.tables[0].writable);
    let column = &schema.tables[0].columns[0];
    assert_eq!(column.sql_name, "status");
    assert_eq!(column.data_type, ColumnType::Select);
    assert_eq!(column.options, vec!["Going", "Declined"]);
    assert!(schema.sql_guide.contains("row_id"));
    assert!(schema.magic_tables.contains("people"));
}

#[test]
fn describing_a_renamed_column_supplies_its_current_label_and_original_sql_identifier() {
    let mut database = detail(AccessGrant::Owner);
    database.tables[0].columns[0].column.display_name = Some("RSVP".into());
    let schema = ToolDatabaseSchema::from(database);
    let column = &schema.tables[0].columns[0];
    assert_eq!(column.name, "RSVP");
    assert_eq!(column.sql_name, "status");
    assert_eq!(column.options, vec!["Going", "Declined"]);
}

#[test]
fn describing_an_entity_column_preserves_the_actual_entity_kind() {
    let mut database = detail(AccessGrant::Owner);
    let definition = &mut database.tables[0].columns[0].definition.definition;
    definition.data_type = DataType::Entity;
    definition.specific_entity_type = Some(models_properties::shared::EntityType::User);
    let json = serde_json::to_value(ToolDatabaseSchema::from(database)).unwrap();
    assert_eq!(
        json["tables"][0]["columns"][0]["specificEntityType"],
        "USER"
    );
    assert_eq!(json["tables"][0]["columns"][0]["dataType"], "entity");
}

/// A view-only grant has to read as unwritable, or the model writes an UPDATE
/// that the executor rejects after the user has been promised an edit.
#[test]
fn a_view_only_database_reads_as_unwritable() {
    let schema = ToolDatabaseSchema::from(detail(AccessGrant::View));
    assert_eq!(schema.grant, ToolGrant::View);
    assert!(!schema.tables[0].writable);
}

#[test]
fn the_response_serializes_with_camel_case_keys() {
    let schema = ToolDatabaseSchema::from(detail(AccessGrant::Owner));
    let json = serde_json::to_value(&schema).expect("schema should serialize");

    assert!(json["tables"][0]["sqlName"].is_string());
    assert!(json["tables"][0]["columns"][0]["isMultiSelect"].is_boolean());
    assert!(json["sqlGuide"].is_string());
}

// --- select options are explicit schema ---

/// The description is what stops a model creating an optionless select column
/// and then failing every INSERT against it.
#[test]
fn add_column_teaches_that_options_are_explicit() {
    let validated = generate_validated_input_schema::<AddColumn>().expect("schema should validate");

    assert!(
        validated.description.contains("explicit schema"),
        "{}",
        validated.description
    );
    assert!(
        validated.description.contains("AddColumnOptions"),
        "the description must point at the way to add more: {}",
        validated.description
    );
}

#[tokio::test]
async fn adding_options_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = AddColumnOptions {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        labels: vec!["Waitlisted".to_string()],
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot change the schema");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().added_options.is_empty());
}

/// The response carries the labels SQL now accepts, so the model can write the
/// statement that just failed without describing the database again.
#[tokio::test]
async fn adding_options_returns_the_labels_sql_accepts() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = AddColumnOptions {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        labels: vec!["Waitlisted".to_string()],
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may extend a select column");

    assert_eq!(response.column_id, COLUMN_ID);
    assert_eq!(response.options, vec!["Going", "Declined", "Waitlisted"]);
    assert_eq!(
        calls.lock().unwrap().added_options,
        vec![(COLUMN_ID, vec!["Waitlisted".to_string()])]
    );
}
