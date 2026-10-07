mod versions;

use chrono::{TimeZone, Utc};
use databases::domain::models::{
    Column, ColumnConfig, ColumnDetail, Database, DatabaseDetail, Table, TableDetail,
};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::PropertyOwner;
use std::sync::{Arc, Mutex};

use databases::domain::models::{DatabaseError, OpRefusal, QueryDefinition, TableVersion};
use entity_access::domain::models::AccessLevel;
use item_filters::ast::database_row::DatabaseRowLiteral;
use models_databases::position::Position;
use models_databases::{
    CellValue, CellWrite, ColumnId, ColumnResult, DatabaseId, DatabaseOp, OpResult, OptionId,
    OptionRef, RowChanges, RowId, RowsChange, RowsResult, TableId,
};
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, EntityReference, EntityType as PropertyEntityType};
use uuid::Uuid;

use super::*;
use database_sql::catalog::{EntityKind, SelectOption};
use database_sql::fold::Cell;
use database_sql::run::OutcomeKind;

use crate::outcome::{ResultColumn, ResultSet, SqlStatement};
use crate::test_support::{
    AppliedOps, OWNER, STRANGER, Shared, StoredRow, VIEWER, World, agent_for, row_literals, sql,
};

const OFFSITE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb01));
const GUESTS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a01));
const VENUES: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb02));
const HALLS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a02));
const SECRET: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb03));
const PLANS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a03));

const NAME: Uuid = Uuid::from_u128(0xc001);
const STATUS: Uuid = Uuid::from_u128(0xc002);
const HALL: Uuid = Uuid::from_u128(0xc003);
const CONTACT: Uuid = Uuid::from_u128(0xc004);
const HALL_NAME: Uuid = Uuid::from_u128(0xc005);
const PLAN_NAME: Uuid = Uuid::from_u128(0xc006);

const NAME_COLUMN: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xb001));
const STATUS_COLUMN: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xb002));
const HALL_COLUMN: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xb003));
const CONTACT_COLUMN: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xb004));
const HALL_NAME_COLUMN: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xb005));
const PLAN_NAME_COLUMN: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xb006));

const GOING: OptionId = OptionId::from_uuid(Uuid::from_u128(0xa001));
const MAYBE: OptionId = OptionId::from_uuid(Uuid::from_u128(0xa002));

const MARIA: RowId = RowId::from_uuid(Uuid::from_u128(0xe001));
const SAM: RowId = RowId::from_uuid(Uuid::from_u128(0xe002));
const BALLROOM: RowId = RowId::from_uuid(Uuid::from_u128(0xe003));
const LAUNCH: RowId = RowId::from_uuid(Uuid::from_u128(0xe004));

/// `Offsite.Guests` (relating to `Venues.Halls`) and `Venues` are the
/// owner's; the viewer can read `Offsite`; `Secret.Plans` is the
/// stranger's alone.
fn world() -> Shared {
    let reference = |id: &str| {
        PropertyValue::EntityRef(vec![EntityReference {
            entity_id: id.to_string(),
            entity_type: PropertyEntityType::User,
            specific_message_id: None,
        }])
    };
    Arc::new(Mutex::new(World {
        databases: vec![
            DatabaseDetail {
                database: Database {
                    id: OFFSITE,
                    name: "Offsite".into(),
                    owner_id: OWNER.to_string(),
                    created_at: Utc::now(),
                    trashed_at: None,
                },
                grant: AccessLevel::Owner,
                tables: vec![TableDetail {
                    table: Table {
                        id: GUESTS,
                        database_id: OFFSITE,
                        name: "Guests".into(),
                        position: "80".parse::<Position>().unwrap(),
                        version: TableVersion(1),
                    },
                    sql_name: "\"Guests\"".into(),
                    columns: vec![
                        ColumnDetail {
                            column: Column {
                                protections: vec![],
                                nullable: true,
                                id: NAME_COLUMN,
                                table_id: GUESTS,
                                property_definition_id: NAME,
                                position: "80".parse::<Position>().unwrap(),
                                config: None,
                                display_name: None,
                                infer_type: false,
                            },
                            sql_name: "\"Name\"".into(),
                            definition: PropertyDefinitionWithOptions {
                                definition: PropertyDefinition {
                                    id: NAME,
                                    owner: PropertyOwner::System,
                                    display_name: "Name".into(),
                                    data_type: DataType::String,
                                    is_multi_select: false,
                                    specific_entity_type: None,
                                    created_at: Utc::now(),
                                    updated_at: Utc::now(),
                                    is_system: false,
                                    is_metadata: false,
                                },
                                property_options: Vec::new(),
                            },
                            writable: true,
                            shared_outside_database: true,
                        },
                        ColumnDetail {
                            column: Column {
                                protections: vec![],
                                nullable: true,
                                id: STATUS_COLUMN,
                                table_id: GUESTS,
                                property_definition_id: STATUS,
                                position: "8180".parse::<Position>().unwrap(),
                                config: None,
                                display_name: None,
                                infer_type: false,
                            },
                            sql_name: "\"Status\"".into(),
                            definition: PropertyDefinitionWithOptions {
                                definition: PropertyDefinition {
                                    id: STATUS,
                                    owner: PropertyOwner::System,
                                    display_name: "Status".into(),
                                    data_type: DataType::SelectString,
                                    is_multi_select: false,
                                    specific_entity_type: None,
                                    created_at: Utc::now(),
                                    updated_at: Utc::now(),
                                    is_system: false,
                                    is_metadata: false,
                                },
                                property_options: vec![
                                    PropertyOption {
                                        id: GOING.into_uuid(),
                                        property_definition_id: STATUS,
                                        display_order: 0,
                                        value: PropertyOptionValue::String("Going".into()),
                                        color: None,
                                        created_at: Utc::now(),
                                        updated_at: Utc::now(),
                                    },
                                    PropertyOption {
                                        id: MAYBE.into_uuid(),
                                        property_definition_id: STATUS,
                                        display_order: 1,
                                        value: PropertyOptionValue::String("Maybe".into()),
                                        color: None,
                                        created_at: Utc::now(),
                                        updated_at: Utc::now(),
                                    },
                                ],
                            },
                            writable: true,
                            shared_outside_database: true,
                        },
                        ColumnDetail {
                            column: Column {
                                protections: vec![],
                                nullable: true,
                                id: HALL_COLUMN,
                                table_id: GUESTS,
                                property_definition_id: HALL,
                                position: "8280".parse::<Position>().unwrap(),
                                config: Some(ColumnConfig::Link {
                                    database_id: VENUES,
                                    table_id: HALLS,
                                }),
                                display_name: None,
                                infer_type: false,
                            },
                            sql_name: "\"Hall\"".into(),
                            definition: PropertyDefinitionWithOptions {
                                definition: PropertyDefinition {
                                    id: HALL,
                                    owner: PropertyOwner::System,
                                    display_name: "Hall".into(),
                                    data_type: DataType::Entity,
                                    is_multi_select: true,
                                    specific_entity_type: None,
                                    created_at: Utc::now(),
                                    updated_at: Utc::now(),
                                    is_system: false,
                                    is_metadata: false,
                                },
                                property_options: Vec::new(),
                            },
                            writable: true,
                            shared_outside_database: true,
                        },
                        ColumnDetail {
                            column: Column {
                                protections: vec![],
                                nullable: true,
                                id: CONTACT_COLUMN,
                                table_id: GUESTS,
                                property_definition_id: CONTACT,
                                position: "8380".parse::<Position>().unwrap(),
                                config: None,
                                display_name: None,
                                infer_type: false,
                            },
                            sql_name: "\"Contact\"".into(),
                            definition: PropertyDefinitionWithOptions {
                                definition: PropertyDefinition {
                                    id: CONTACT,
                                    owner: PropertyOwner::System,
                                    display_name: "Contact".into(),
                                    data_type: DataType::Entity,
                                    is_multi_select: false,
                                    specific_entity_type: Some(models_properties::EntityType::User),
                                    created_at: Utc::now(),
                                    updated_at: Utc::now(),
                                    is_system: false,
                                    is_metadata: false,
                                },
                                property_options: Vec::new(),
                            },
                            writable: true,
                            shared_outside_database: true,
                        },
                    ],
                    views: Vec::new(),
                }],
            },
            DatabaseDetail {
                database: Database {
                    id: VENUES,
                    name: "Venues".into(),
                    owner_id: OWNER.to_string(),
                    created_at: Utc::now(),
                    trashed_at: None,
                },
                grant: AccessLevel::Owner,
                tables: vec![TableDetail {
                    table: Table {
                        id: HALLS,
                        database_id: VENUES,
                        name: "Halls".into(),
                        position: "80".parse::<Position>().unwrap(),
                        version: TableVersion(1),
                    },
                    sql_name: "\"Halls\"".into(),
                    columns: vec![ColumnDetail {
                        column: Column {
                            protections: vec![],
                            nullable: true,
                            id: HALL_NAME_COLUMN,
                            table_id: HALLS,
                            property_definition_id: HALL_NAME,
                            position: "80".parse::<Position>().unwrap(),
                            config: None,
                            display_name: None,
                            infer_type: false,
                        },
                        sql_name: "\"Name\"".into(),
                        definition: PropertyDefinitionWithOptions {
                            definition: PropertyDefinition {
                                id: HALL_NAME,
                                owner: PropertyOwner::System,
                                display_name: "Name".into(),
                                data_type: DataType::String,
                                is_multi_select: false,
                                specific_entity_type: None,
                                created_at: Utc::now(),
                                updated_at: Utc::now(),
                                is_system: false,
                                is_metadata: false,
                            },
                            property_options: Vec::new(),
                        },
                        writable: true,
                        shared_outside_database: true,
                    }],
                    views: Vec::new(),
                }],
            },
            DatabaseDetail {
                database: Database {
                    id: SECRET,
                    name: "Secret".into(),
                    owner_id: OWNER.to_string(),
                    created_at: Utc::now(),
                    trashed_at: None,
                },
                grant: AccessLevel::Owner,
                tables: vec![TableDetail {
                    table: Table {
                        id: PLANS,
                        database_id: SECRET,
                        name: "Plans".into(),
                        position: "80".parse::<Position>().unwrap(),
                        version: TableVersion(1),
                    },
                    sql_name: "\"Plans\"".into(),
                    columns: vec![ColumnDetail {
                        column: Column {
                            protections: vec![],
                            nullable: true,
                            id: PLAN_NAME_COLUMN,
                            table_id: PLANS,
                            property_definition_id: PLAN_NAME,
                            position: "80".parse::<Position>().unwrap(),
                            config: None,
                            display_name: None,
                            infer_type: false,
                        },
                        sql_name: "\"Name\"".into(),
                        definition: PropertyDefinitionWithOptions {
                            definition: PropertyDefinition {
                                id: PLAN_NAME,
                                owner: PropertyOwner::System,
                                display_name: "Name".into(),
                                data_type: DataType::String,
                                is_multi_select: false,
                                specific_entity_type: None,
                                created_at: Utc::now(),
                                updated_at: Utc::now(),
                                is_system: false,
                                is_metadata: false,
                            },
                            property_options: Vec::new(),
                        },
                        writable: true,
                        shared_outside_database: true,
                    }],
                    views: Vec::new(),
                }],
            },
        ],
        grants: vec![
            (OWNER, OFFSITE, AccessLevel::Owner),
            (OWNER, VENUES, AccessLevel::Owner),
            (VIEWER, OFFSITE, AccessLevel::View),
            (STRANGER, SECRET, AccessLevel::Owner),
        ],
        rows: vec![
            StoredRow {
                id: MARIA.into_uuid(),
                table_id: GUESTS,
                database_id: OFFSITE,
                position: "80".to_string(),
                created_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 1, 0).unwrap(),
                cells: vec![
                    (NAME, PropertyValue::Str("Maria".into())),
                    (STATUS, PropertyValue::SelectOption(vec![GOING.into_uuid()])),
                    (
                        HALL,
                        PropertyValue::EntityRef(vec![EntityReference {
                            entity_id: BALLROOM.to_string(),
                            entity_type: PropertyEntityType::DatabaseRow,
                            specific_message_id: None,
                        }]),
                    ),
                    (CONTACT, reference("macro|maria@macro.com")),
                ],
            },
            StoredRow {
                id: SAM.into_uuid(),
                table_id: GUESTS,
                database_id: OFFSITE,
                position: "8180".to_string(),
                created_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 2, 0).unwrap(),
                cells: vec![
                    (NAME, PropertyValue::Str("Sam".into())),
                    (STATUS, PropertyValue::SelectOption(vec![MAYBE.into_uuid()])),
                ],
            },
            StoredRow {
                id: BALLROOM.into_uuid(),
                table_id: HALLS,
                database_id: VENUES,
                position: "8280".to_string(),
                created_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 3, 0).unwrap(),
                cells: vec![(HALL_NAME, PropertyValue::Str("Ballroom".into()))],
            },
            StoredRow {
                id: LAUNCH.into_uuid(),
                table_id: PLANS,
                database_id: SECRET,
                position: "8380".to_string(),
                created_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 4, 0).unwrap(),
                cells: vec![(PLAN_NAME, PropertyValue::Str("Launch".into()))],
            },
        ],
        contacts: vec!["macro|maria@macro.com", "macro|sam@macro.com"],
        ..World::default()
    }))
}

#[tokio::test]
async fn a_strangers_database_is_not_in_the_catalog() {
    let world = world();
    let error = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT \"Name\" FROM \"Secret\".\"Plans\"".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("the owner holds no grant on Secret");

    let SqlError::Compile(compile_error) = error else {
        panic!("a missing table does not compile: {error:?}");
    };
    assert!(
        compile_error.to_string().contains("unknown table"),
        "{compile_error}"
    );
    assert!(world.lock().unwrap().soup_reads.is_empty());

    let outcome = sql(&world)
        .execute(
            agent_for(STRANGER),
            SqlRequest {
                sql: "SELECT \"Name\" FROM \"Secret\".\"Plans\"".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("the stranger reads their own table");
    assert_eq!(
        outcome.result.as_ref().unwrap().rows,
        vec![vec![Some(Cell::Text("Launch".into()))]]
    );
    assert_eq!(outcome.result.as_ref().unwrap().row_ids, vec![LAUNCH]);
}

#[tokio::test]
async fn a_view_only_database_cannot_be_written() {
    let world = world();
    let error = sql(&world)
        .execute(
            agent_for(VIEWER),
            SqlRequest {
                sql:
                    "UPDATE \"Offsite\".\"Guests\" SET \"Status\" = 'Going' WHERE \"Name\" = 'Sam'"
                        .into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("a view grant does not write");

    assert!(
        matches!(&error, SqlError::TableReadOnly { table } if table == "Guests"),
        "{error:?}"
    );
    assert_eq!(error.to_string(), "table Guests is read-only");
    let world = world.lock().unwrap();
    assert!(world.applied.is_empty());
    assert!(world.soup_reads.is_empty());
}

#[tokio::test]
async fn a_write_is_applied_under_an_edit_receipt_for_its_database() {
    let world = world();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Ok(vec![OpResult::Rows {
            table: GUESTS,
            table_version: TableVersion(2),
            change: RowsResult::Updated { affected: 1 },
        }]));
    let outcome = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql:
                    "UPDATE \"Offsite\".\"Guests\" SET \"Status\" = 'Going' WHERE \"Name\" = 'Sam'"
                        .into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("the owner writes");

    assert_eq!(outcome.changes_applied, 1);
    assert_eq!(
        outcome.new_versions,
        HashMap::from([(GUESTS, TableVersion(2))])
    );
    assert_eq!(
        world.lock().unwrap().applied,
        vec![AppliedOps {
            database: OFFSITE,
            level: AccessLevel::Owner,
            acting_bot: Some(bot_id::MACRO_AI_BOT_ID),
            ops: vec![DatabaseOp::Rows {
                table: GUESTS,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![SAM],
                        cells: vec![CellWrite {
                            column: STATUS_COLUMN,
                            value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                        }],
                    }
                },
            }],
        }]
    );
}

#[tokio::test]
async fn a_cross_database_join_only_sees_databases_the_viewer_can_reach() {
    let join = "SELECT g.\"Name\", h.\"Name\" AS hall FROM \"Offsite\".\"Guests\" g \
                JOIN \"Venues\".\"Halls\" h ON g.\"Hall\" = h.row_id";

    let world = world();
    let outcome = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: join.into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("the owner reaches both databases");
    assert_eq!(
        outcome.result.as_ref().unwrap().rows,
        vec![vec![
            Some(Cell::Text("Maria".into())),
            Some(Cell::Text("Ballroom".into())),
        ]]
    );
    assert_eq!(outcome.result.as_ref().unwrap().row_ids, vec![MARIA]);
    let reads: Vec<Vec<DatabaseRowLiteral>> = world
        .lock()
        .unwrap()
        .soup_reads
        .iter()
        .map(row_literals)
        .collect();
    assert_eq!(
        reads,
        vec![
            vec![DatabaseRowLiteral::TableId(GUESTS.into_uuid())],
            vec![
                DatabaseRowLiteral::TableId(HALLS.into_uuid()),
                DatabaseRowLiteral::Id(BALLROOM.into_uuid())
            ],
        ]
    );

    let world = self::world();
    let error = sql(&world)
        .execute(
            agent_for(VIEWER),
            SqlRequest {
                sql: join.into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("the viewer holds no grant on Venues");
    assert!(
        matches!(&error, SqlError::Compile(compile_error) if compile_error.to_string().contains("unknown table")),
        "{error:?}"
    );
    assert!(world.lock().unwrap().soup_reads.is_empty());

    let error = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT g.\"Name\" FROM \"Offsite\".\"Guests\" g \
                 JOIN \"Secret\".\"Plans\" p ON g.\"Name\" = p.\"Name\""
                    .into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("the owner holds no grant on Secret");
    assert!(
        matches!(&error, SqlError::Compile(compile_error) if compile_error.to_string().contains("unknown table")),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_read_answers_typed_cells_with_what_renders_them() {
    let world = world();
    let outcome = sql(&world)
        .execute(
            agent_for(VIEWER),
            SqlRequest { sql: "SELECT \"Name\", \"Status\", \"Contact\" FROM \"Offsite\".\"Guests\" WHERE \"Status\" = 'Going'".into(), scope: None, base_versions: HashMap::new() },
        )
        .await
        .expect("the viewer reads");

    assert_eq!(
        outcome.result.as_ref().unwrap(),
        &ResultSet {
            columns: vec![
                ResultColumn {
                    name: "Name".into(),
                    kind: OutcomeKind::Text,
                    options: vec![],
                    target: None,
                    related_table: None,
                },
                ResultColumn {
                    name: "Status".into(),
                    kind: OutcomeKind::Select,
                    options: vec![
                        SelectOption {
                            id: GOING,
                            label: "Going".into(),
                        },
                        SelectOption {
                            id: MAYBE,
                            label: "Maybe".into(),
                        },
                    ],
                    target: None,
                    related_table: None,
                },
                ResultColumn {
                    name: "Contact".into(),
                    kind: OutcomeKind::Entity,
                    options: vec![],
                    target: Some(EntityKind::User),
                    related_table: None,
                },
            ],
            rows: vec![vec![
                Some(Cell::Text("Maria".into())),
                Some(Cell::Options(vec![GOING])),
                Some(Cell::Entities(vec!["macro|maria@macro.com".into()])),
            ]],
            row_ids: vec![MARIA],
        }
    );
    assert_eq!(
        outcome.read_versions,
        HashMap::from([(GUESTS, TableVersion(1))])
    );
    // The select filter went to Soup as a property filter on the table.
    let world = world.lock().unwrap();
    assert_eq!(world.soup_reads.len(), 1);
    assert!(world.soup_reads[0].properties_filter.is_some());
}

#[tokio::test]
async fn a_relation_column_names_the_table_its_rows_belong_to() {
    let world = world();
    let outcome = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT \"Hall\" FROM \"Offsite\".\"Guests\" WHERE \"Name\" = 'Maria'".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("the owner reads");

    assert_eq!(
        outcome.result.as_ref().unwrap().columns,
        vec![ResultColumn {
            name: "Hall".into(),
            kind: OutcomeKind::Entity,
            options: vec![],
            target: Some(EntityKind::Row),
            related_table: Some(HALLS),
        }]
    );
    assert_eq!(
        outcome.result.as_ref().unwrap().rows,
        vec![vec![Some(Cell::Entities(vec![BALLROOM.to_string()]))]]
    );
}

#[tokio::test]
async fn a_count_per_option_is_read_as_soup_bins() {
    let world = world();
    let outcome = sql(&world)
        .execute(
            agent_for(VIEWER),
            SqlRequest { sql: "SELECT \"Status\", COUNT(*) AS guests FROM \"Offsite\".\"Guests\" GROUP BY \"Status\"".into(), scope: None, base_versions: HashMap::new() },
        )
        .await
        .expect("the viewer counts");

    let mut rows = outcome.result.as_ref().unwrap().rows.clone();
    rows.sort_by_key(|row| format!("{:?}", row[0]));
    assert_eq!(
        rows,
        vec![
            vec![Some(Cell::Options(vec![GOING])), Some(Cell::Number(1.0))],
            vec![Some(Cell::Options(vec![MAYBE])), Some(Cell::Number(1.0))],
        ]
    );
    assert!(outcome.result.as_ref().unwrap().row_ids.is_empty());
}

#[tokio::test]
async fn people_are_the_viewers_contacts() {
    let world = world();
    let outcome = sql(&world)
        .execute(
            agent_for(VIEWER),
            SqlRequest {
                sql: "SELECT g.\"Name\", p.email FROM \"Offsite\".\"Guests\" g \
                 JOIN macro.people p ON g.\"Contact\" = p.id"
                    .into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("people join like any table");

    assert_eq!(
        outcome.result.as_ref().unwrap().rows,
        vec![vec![
            Some(Cell::Text("Maria".into())),
            Some(Cell::Text("maria@macro.com".into())),
        ]]
    );
}

#[tokio::test]
async fn view_only_sql_refuses_an_owners_write_as_a_view_grant_is_refused() {
    let world = world();
    let error = sql(&world)
        .view_only()
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "DELETE FROM \"Offsite\".\"Guests\" WHERE \"Name\" = 'Sam'".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("view-only access never writes");

    assert!(
        matches!(&error, SqlError::TableReadOnly { table } if table == "Guests"),
        "{error:?}"
    );
    assert!(world.lock().unwrap().applied.is_empty());

    let outcome = sql(&world)
        .view_only()
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT COUNT(*) FROM \"Offsite\".\"Guests\"".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("view-only access reads");
    assert_eq!(
        outcome.result.as_ref().unwrap().rows,
        vec![vec![Some(Cell::Number(2.0))]]
    );
}

#[tokio::test]
async fn a_stale_base_version_refuses_the_write() {
    let world = world();
    let error = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "DELETE FROM \"Offsite\".\"Guests\" WHERE \"Name\" = 'Sam'".into(),
                scope: Some(OFFSITE),
                base_versions: HashMap::from([(GUESTS, TableVersion(0))]),
            },
        )
        .await
        .expect_err("the table moved past version 0");

    assert!(
        matches!(error, SqlError::VersionConflict { table_id } if table_id == GUESTS),
        "{error:?}"
    );
    assert!(world.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn an_alter_column_reports_the_column_it_changed() {
    let world = world();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Ok(vec![OpResult::Column {
            table: GUESTS,
            column: STATUS_COLUMN,
            table_version: TableVersion(2),
            change: ColumnResult::TypeChanged,
        }]));
    let outcome = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "ALTER TABLE \"Offsite\".\"Guests\" ALTER COLUMN \"Status\" TYPE text".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect("the owner retypes");

    assert_eq!(
        outcome.statement,
        SqlStatement::AlterColumnType {
            table_id: GUESTS,
            table_name: "Guests".into(),
            column_id: STATUS_COLUMN,
            column_name: "Status".into(),
            to: "text".into(),
        }
    );
}

#[tokio::test]
async fn a_question_is_saved_once_it_compiles_as_a_select_in_its_database() {
    let world = world();
    let definition = QueryDefinition::V1 {
        query: "SELECT COUNT(*) FROM \"Guests\"".into(),
    };
    let saved = sql(&world)
        .save_query(agent_for(VIEWER), Some(OFFSITE), definition.clone(), None)
        .await
        .expect("the viewer saves a read");

    assert_eq!(saved.database_id, Some(OFFSITE));
    assert_eq!(
        world.lock().unwrap().saved,
        vec![(Some(OFFSITE), definition)]
    );
}

#[tokio::test]
async fn a_question_that_writes_or_does_not_compile_is_not_saved() {
    let world = world();
    let writes = sql(&world)
        .save_query(
            agent_for(OWNER),
            Some(OFFSITE),
            QueryDefinition::V1 {
                query: "DELETE FROM \"Guests\" WHERE \"Name\" = 'Sam'".into(),
            },
            None,
        )
        .await
        .expect_err("a saved question never writes");
    assert!(
        matches!(writes, SqlError::SavedQueryNotSelect),
        "{writes:?}"
    );

    let broken = sql(&world)
        .save_query(
            agent_for(OWNER),
            Some(OFFSITE),
            QueryDefinition::V1 {
                query: "SELECT statuz FROM \"Guests\"".into(),
            },
            None,
        )
        .await
        .expect_err("a broken question is not saved");
    assert!(matches!(broken, SqlError::Compile(_)), "{broken:?}");

    let hidden = sql(&world)
        .save_query(
            agent_for(OWNER),
            Some(SECRET),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) FROM \"Plans\"".into(),
            },
            None,
        )
        .await
        .expect_err("the owner cannot see Secret");
    assert!(matches!(hidden, SqlError::NotFound), "{hidden:?}");

    assert!(world.lock().unwrap().saved.is_empty());
}

#[tokio::test]
async fn a_write_the_service_refuses_names_its_row_and_reason() {
    let world = world();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Err(DatabaseError::InvalidOp(OpRefusal {
            op: 0,
            row: Some(0),
            column: Some(STATUS_COLUMN),
            taken: None,
            reason: "\"Status\" has no option \"Gone\"".into(),
        })));
    let error = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql:
                    "UPDATE \"Offsite\".\"Guests\" SET \"Status\" = 'Going' WHERE \"Name\" = 'Sam'"
                        .into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("the service refuses the write");

    assert!(
        matches!(
            &error,
            SqlError::WriteRefused { row: Some(1), reason }
                if reason == "\"Status\" has no option \"Gone\""
        ),
        "{error:?}"
    );
    assert_eq!(
        error.to_string(),
        "row 1: \"Status\" has no option \"Gone\""
    );
}

#[tokio::test]
async fn a_table_that_moves_during_the_write_is_a_version_conflict() {
    let world = world();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Err(DatabaseError::VersionConflict));
    let error = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "DELETE FROM \"Offsite\".\"Guests\" WHERE \"Name\" = 'Sam'".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .expect_err("the table moved");

    assert!(
        matches!(error, SqlError::VersionConflict { table_id } if table_id == GUESTS),
        "{error:?}"
    );
}

#[tokio::test]
async fn schema_sql_uses_atomic_ops_and_preserves_actor() {
    let world = world();
    world.lock().unwrap().op_answers.push_back(Ok(Vec::new()));
    let result = sql(&world).execute(agent_for(OWNER), SqlRequest {sql: "CREATE TABLE Offsite.Tasks (Name text, Done boolean, Stage select OPTIONS ('Todo', 'Done'))".into(), scope: Some(OFFSITE), base_versions: HashMap::new()}).await.unwrap();
    assert!(matches!(
        result.statement,
        SqlStatement::Schema {
            database_id: OFFSITE,
            ..
        }
    ));
    let world = world.lock().unwrap();
    let batch = world.applied.last().unwrap();
    assert_eq!(batch.database, OFFSITE);
    assert_eq!(batch.ops.len(), 4);
    assert!(matches!(
        batch.ops[0],
        DatabaseOp::Table {
            change: models_databases::TableChange::Create { .. },
            ..
        }
    ));
    assert_eq!(batch.acting_bot, agent_for(OWNER).acting_bot);
}

#[tokio::test]
async fn schema_sql_refuses_viewers_and_read_only_hosts_before_writing() {
    let world = world();
    for statement in [
        "CREATE TABLE Offsite.Tasks (Name text)",
        "DROP TABLE Offsite.Guests",
        "ALTER TABLE Offsite.Guests ADD COLUMN Budget number",
    ] {
        let request = SqlRequest {
            sql: statement.into(),
            scope: Some(OFFSITE),
            base_versions: HashMap::new(),
        };
        assert!(
            sql(&world)
                .execute(agent_for(VIEWER), request.clone())
                .await
                .is_err()
        );
        assert!(
            sql(&world)
                .view_only()
                .execute(agent_for(OWNER), request)
                .await
                .is_err()
        );
    }
    assert!(
        sql(&world)
            .view_only()
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: "CREATE DATABASE Nope".into(),
                    scope: None,
                    base_versions: HashMap::new()
                }
            )
            .await
            .is_err()
    );
    assert!(world.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn schema_sql_resolves_column_placements_and_never_writes_hidden_tables() {
    let world = world();
    world.lock().unwrap().op_answers.push_back(Ok(Vec::new()));
    sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "ALTER TABLE Offsite.Guests RENAME COLUMN status TO RSVP".into(),
                scope: Some(OFFSITE),
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();
    assert!(
        matches!(&world.lock().unwrap().applied[0].ops[0], DatabaseOp::Column {column: STATUS_COLUMN, change: models_databases::ColumnChange::Rename {previous_name: Some(name), ..}, ..} if name == "Status")
    );
    let denied = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "DROP TABLE Secret.Plans".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await;
    assert!(denied.is_err());
    assert_eq!(world.lock().unwrap().applied.len(), 1);
}

#[tokio::test]
async fn schema_database_resolution_prefers_scope_and_reorder_reports_versions() {
    let world = world();
    world.lock().unwrap().databases[1].database.name = "Offsite".into();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Ok(vec![OpResult::ReorderTables {
            tables: vec![models_databases::VersionedTable {
                table: GUESTS,
                version: TableVersion(2),
            }],
        }]));
    let result = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "ALTER DATABASE Offsite REORDER TABLES (Guests)".into(),
                scope: Some(OFFSITE),
                base_versions: HashMap::from([(GUESTS, TableVersion(1)), (HALLS, TableVersion(9))]),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        result.new_versions,
        HashMap::from([(GUESTS, TableVersion(2))])
    );
    assert_eq!(
        world.lock().unwrap().guarded[0],
        HashMap::from([(GUESTS, TableVersion(1))])
    );
    sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "ALTER DATABASE Offsite RENAME TO Planning".into(),
                scope: Some(OFFSITE),
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();
    assert_eq!(world.lock().unwrap().databases[0].database.name, "Planning");
    assert_eq!(world.lock().unwrap().databases[1].database.name, "Offsite");
}

#[tokio::test]
async fn sql_database_creation_acknowledges_id_and_actor_without_a_followup_read() {
    let world = world();
    let result = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "CREATE DATABASE Planning".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(result.statement, SqlStatement::Schema { .. }));
    let world = world.lock().unwrap();
    assert_eq!(world.created[0].name, "Planning");
    assert_eq!(world.created[0].acting_bot, agent_for(OWNER).acting_bot);
}

#[tokio::test]
async fn schema_reorder_resolves_tables_only_in_the_selected_database() {
    for (database, other_database, name, other_name, sql_name, scope) in [
        ("Offsite", "offsite", "Guests", "guests", "GUESTS", None),
        (
            "macro",
            "other",
            "people",
            "People",
            "people",
            Some(OFFSITE),
        ),
    ] {
        let world = world();
        {
            let mut held = world.lock().unwrap();
            held.databases[0].database.name = database.into();
            held.databases[0].tables[0].table.name = name.into();
            held.databases[1].database.name = other_database.into();
            held.databases[1].tables[0].table.name = other_name.into();
            held.op_answers.push_back(Ok(Vec::new()));
        }
        sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: format!("ALTER DATABASE {database} REORDER TABLES ({sql_name})"),
                    scope,
                    base_versions: HashMap::new(),
                },
            )
            .await
            .unwrap();
        let held = world.lock().unwrap();
        assert_eq!(held.applied[0].database, OFFSITE);
        assert!(
            matches!(&held.applied[0].ops[0], DatabaseOp::ReorderTables { order } if order == &[GUESTS])
        );
    }
}

#[tokio::test]
async fn create_table_resolves_relations_against_its_destination_schema() {
    for target in ["Tasks", "Offsite.Tasks", "Venues.Tasks"] {
        let world = world();
        {
            let mut held = world.lock().unwrap();
            held.databases[1].tables[0].table.name = "Tasks".into();
            held.op_answers.push_back(Ok(Vec::new()));
        }
        sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: format!("CREATE TABLE Offsite.Tasks (Parent relation({target}))"),
                    scope: None,
                    base_versions: HashMap::new(),
                },
            )
            .await
            .unwrap();
        let held = world.lock().unwrap();
        let batch = &held.applied[0];
        let created = batch.ops[0].table().unwrap();
        let (expected_database, expected_table) = if target == "Venues.Tasks" {
            (
                held.databases[1].database.id,
                held.databases[1].tables[0].table.id,
            )
        } else {
            (OFFSITE, created)
        };
        assert!(matches!(
            &batch.ops[1],
            DatabaseOp::Column {
                change: models_databases::ColumnChange::Create {
                    definition: models_databases::NewColumn::New {
                        kind: models_databases::ColumnKind::Relation { database, table },
                        ..
                    },
                    ..
                },
                ..
            } if *database == expected_database && *table == expected_table
        ));
    }
}

#[tokio::test]
async fn schema_version_conflicts_keep_the_retry_signal() {
    for statement in [
        "ALTER TABLE Offsite.Guests RENAME COLUMN Name TO FullName",
        "ALTER DATABASE Offsite REORDER TABLES (Guests)",
    ] {
        let world = world();
        world
            .lock()
            .unwrap()
            .op_answers
            .push_back(Err(DatabaseError::VersionConflict));
        let error = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: statement.into(),
                    scope: None,
                    base_versions: HashMap::from([(GUESTS, TableVersion(1))]),
                },
            )
            .await
            .unwrap_err();
        if statement.starts_with("ALTER DATABASE") {
            assert!(
                matches!(error, SqlError::SchemaVersionConflict { database_id } if database_id == OFFSITE),
                "{error:?}"
            );
        } else {
            assert!(
                matches!(error, SqlError::VersionConflict { table_id } if table_id == GUESTS),
                "{error:?}"
            );
        }
    }
}
