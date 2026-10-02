//! Typed ops through the service as hosts build it, over Postgres: a batch
//! commits whole, and a refused op leaves nothing of it behind.

use models_databases::OptionId;
use std::sync::Arc;

use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
};
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, ColumnResult, DatabaseOp, NewColumn, NewOption,
    OpResult, OptionRef, RowChange, RowChanges, RowsChange, RowsResult, TableChange,
};
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, EntityReference, EntityType as PropertyEntityType};
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    ColumnId, CreateDatabase, DatabaseError, DatabaseId, OpRefusal, PropertyDefinitionId, RowId,
    TableId, TableVersion, Viewer,
};
use crate::domain::ports::{CellStore, ColumnDefinitionStore, DatabasesRepo, DatabasesService};
use crate::outbound::gateway_event_publisher::NoOpTableEventPublisher;
use crate::outbound::pg_cell_store::PgCellStore;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use crate::outbound::pg_definition_store::PgDefinitionStore;
use crate::wiring::{PgDatabasesService, build_service};

const USER: &str = "macro|apply-ops@macro.com";

pub(super) fn viewer() -> Viewer {
    Viewer {
        user_id: MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
        acting_bot: None,
    }
}

pub(super) fn edit(database_id: DatabaseId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
        Entity {
            entity_id: database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

pub(super) async fn insert_user(pool: &PgPool) {
    insert_named_user(pool, USER).await;
}

pub(super) async fn insert_named_user(pool: &PgPool, user: &str) {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#, id, user)
        .execute(pool).await.unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        id
    )
    .execute(pool)
    .await
    .unwrap();
}

/// `Guests(Name TEXT, Status SELECT[Going])` in a new database.
pub(super) struct Guests {
    pub(super) database_id: DatabaseId,
    pub(super) table_id: TableId,
    pub(super) name: ColumnId,
    pub(super) name_definition: PropertyDefinitionId,
    pub(super) status: ColumnId,
    pub(super) status_definition: PropertyDefinitionId,
}

pub(super) async fn guests(pool: &PgPool) -> Guests {
    insert_user(pool).await;
    let service = service(pool);
    let database = service
        .create_database(CreateDatabase {
            name: "Offsite".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let table_id = repo.get_database(database.id).await.unwrap().unwrap().1[0].id;
    // The database starts with its title column, Name.
    let name = repo.columns_for_tables(&[table_id]).await.unwrap()[0].id;
    let status = ColumnId::new();
    service
        .apply_ops(
            edit(database.id),
            viewer(),
            vec![DatabaseOp::Column {
                table: table_id,
                column: status,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Status".into(),
                        kind: ColumnKind::Select { multi: false },
                        options: vec![NewOption {
                            id: OptionId::new(),
                            label: "Going".into(),
                        }],
                        infer_type: false,
                    },
                    after: None,
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let columns = repo.columns_for_tables(&[table_id]).await.unwrap();
    let definition_of = |column: ColumnId| {
        columns
            .iter()
            .find(|placement| placement.id == column)
            .unwrap()
            .property_definition_id
    };
    Guests {
        database_id: database.id,
        table_id,
        name,
        name_definition: definition_of(name),
        status,
        status_definition: definition_of(status),
    }
}

/// The service as hosts build it, with no liveness or domain events.
pub(super) fn service(
    pool: &PgPool,
) -> PgDatabasesService<
    NoOpTableEventPublisher,
    NoopMacroEventBroker,
    EntityAccessServiceImpl<PgAccessRepository>,
> {
    build_service(
        pool.clone(),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        NoOpTableEventPublisher,
        NoopMacroEventBroker,
    )
}

pub(super) fn cells(pool: &PgPool) -> PgCellStore<PropertiesPgRepo> {
    PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
}

pub(super) async fn version(pool: &PgPool, table_id: TableId) -> TableVersion {
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .table_versions(&[table_id])
        .await
        .unwrap()[&table_id]
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ops_insert_update_and_delete_rows_bumping_the_table_once_per_request(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;

    let inserted = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Sam".into()),
                        }],
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Alex".into()),
                        }],
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Robin".into()),
                        }],
                    ],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            table_version,
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert of three rows, got {inserted:?}");
    };
    assert_eq!(*table_version, TableVersion(before.0 + 1));
    assert_eq!(inserted.len(), 3);
    let rows = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(guests.table_id)
        .await
        .unwrap();
    assert_eq!(
        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        inserted.clone()
    );
    let (sam, alex, robin) = (inserted[0], inserted[1], inserted[2]);

    let going = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[guests.status_definition])
        .await
        .unwrap()[0]
        .property_options[0]
        .id;
    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::Uniform {
                            rows: vec![sam, alex, robin],
                            cells: vec![CellWrite {
                                column: guests.status,
                                value: CellValue::Options(vec![OptionRef::Id(
                                    OptionId::from_uuid(going),
                                )]),
                            }],
                        },
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow {
                            rows: vec![
                                RowChange {
                                    row: sam,
                                    cells: vec![CellWrite {
                                        column: guests.name,
                                        value: CellValue::Text("Samantha".into()),
                                    }],
                                },
                                RowChange {
                                    row: alex,
                                    cells: vec![CellWrite {
                                        column: guests.status,
                                        value: CellValue::Clear,
                                    }],
                                },
                            ],
                        },
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Delete { rows: vec![robin] },
                },
            ]
            .into(),
        )
        .await
        .unwrap();

    let after = TableVersion(before.0 + 2);
    assert_eq!(
        results,
        vec![
            OpResult::Rows {
                table: guests.table_id,
                table_version: after,
                change: RowsResult::Updated { affected: 3 },
            },
            OpResult::Rows {
                table: guests.table_id,
                table_version: after,
                change: RowsResult::Updated { affected: 2 },
            },
            OpResult::Rows {
                table: guests.table_id,
                table_version: after,
                change: RowsResult::Deleted { affected: 1 },
            },
        ]
    );
    assert_eq!(version(&pool, guests.table_id).await, after);
    let rows = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(guests.table_id)
        .await
        .unwrap();
    assert_eq!(
        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![sam, alex]
    );
    let stored = cells(&pool).cells(&[sam, alex, robin]).await.unwrap();
    assert_eq!(
        stored[&sam][&guests.name_definition],
        PropertyValue::Str("Samantha".into())
    );
    assert_eq!(
        stored[&sam][&guests.status_definition],
        PropertyValue::SelectOption(vec![going])
    );
    assert_eq!(
        stored[&alex][&guests.name_definition],
        PropertyValue::Str("Alex".into())
    );
    assert!(!stored[&alex].contains_key(&guests.status_definition));
    assert!(stored.get(&robin).is_none_or(|cells| cells.is_empty()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_label_is_refused_and_creates_no_option(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let definitions = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));

    let refused = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: guests.status,
                        value: CellValue::Options(vec![OptionRef::Label("Maybe".into())]),
                    }]],
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = refused else {
        panic!("expected a refused op, got {refused:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: Some(0),
            column: Some(guests.status),
            taken: None,
            reason: "`Maybe` is not an option of \"Status\"".into(),
        }
    );
    let options: Vec<PropertyOptionValue> = definitions
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options
        .into_iter()
        .map(|option| option.value)
        .collect();
    assert_eq!(options, vec![PropertyOptionValue::String("Going".into())]);
    assert!(
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .row_refs(guests.table_id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_refused_op_leaves_nothing_of_its_batch_behind(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let ghost = macro_uuid::generate_uuid_v7();

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: guests.status,
                            value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                        }]],
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Delete {
                        rows: vec![RowId::from_uuid(ghost)],
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 1,
            row: Some(0),
            column: None,
            taken: None,
            reason: format!("no row {ghost} in this table"),
        }
    );
    assert!(
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .row_refs(guests.table_id)
            .await
            .unwrap()
            .is_empty()
    );
    let options = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options;
    assert_eq!(options.len(), 1);
    assert_eq!(version(&pool, guests.table_id).await, before);
    let orphaned = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_properties WHERE property_definition_id = $1",
        guests.status_definition
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(orphaned, Some(0));

    let elsewhere = service
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    let elsewhere_table = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .get_database(elsewhere.id)
        .await
        .unwrap()
        .unwrap()
        .1[0]
        .id;
    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert { rows: vec![vec![]] },
                },
                DatabaseOp::Rows {
                    table: elsewhere_table,
                    change: RowsChange::Insert { rows: vec![vec![]] },
                },
            ]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(refusal.op, 1);
    for table in [guests.table_id, elsewhere_table] {
        assert!(
            PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
                .row_refs(table)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_relation_cell_holds_rows_of_its_target_table(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let sessions = TableId::new();
    let relation = ColumnId::new();
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Table {
                    table: sessions,
                    change: TableChange::Create {
                        name: "Sessions".into(),
                    },
                },
                DatabaseOp::Column {
                    table: guests.table_id,
                    column: relation,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Sessions".into(),
                            kind: ColumnKind::Relation {
                                database: guests.database_id,
                                table: sessions,
                            },
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let relation_definition =
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .columns_for_tables(&[guests.table_id])
            .await
            .unwrap()
            .into_iter()
            .find(|column| column.id == relation)
            .unwrap()
            .property_definition_id;
    let keynote = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: sessions,
                change: RowsChange::Insert { rows: vec![vec![]] },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = keynote.as_slice()
    else {
        panic!("expected one insert, got {keynote:?}");
    };
    let keynote = inserted[0];

    let guest = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: relation,
                        value: CellValue::Rows(vec![keynote]),
                    }]],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = guest.as_slice()
    else {
        panic!("expected one insert, got {guest:?}");
    };
    let guest = inserted[0];
    assert_eq!(
        cells(&pool).cells(&[guest]).await.unwrap()[&guest][&relation_definition],
        PropertyValue::EntityRef(vec![EntityReference {
            entity_id: keynote.to_string(),
            entity_type: PropertyEntityType::DatabaseRow,
            specific_message_id: None,
        }])
    );

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row: guest,
                            cells: vec![CellWrite {
                                column: relation,
                                value: CellValue::Rows(vec![guest]),
                            }],
                        }],
                    },
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: Some(0),
            column: Some(relation),
            taken: None,
            reason: format!("row {guest} is not a row of the related table"),
        }
    );
    assert_eq!(
        cells(&pool).cells(&[guest]).await.unwrap()[&guest][&relation_definition],
        PropertyValue::EntityRef(vec![EntityReference {
            entity_id: keynote.to_string(),
            entity_type: PropertyEntityType::DatabaseRow,
            specific_message_id: None,
        }])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_type_change_refuses_misfits_and_keeps_the_cells(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let inserted = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("12".into()),
                        }],
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("TBD".into()),
                        }],
                    ],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };

    let refused = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.name,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Number,
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = refused else {
        panic!("expected a refused op, got {refused:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: None,
            column: Some(guests.name),
            taken: None,
            reason: "1 value in \"Name\" isn't a number: 'TBD'. Fix it, or add a column of the new type for the values that convert.".into(),
        }
    );

    let columns = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[guests.table_id])
        .await
        .unwrap();
    let name = columns
        .iter()
        .find(|column| column.id == guests.name)
        .unwrap();
    assert_eq!(name.property_definition_id, guests.name_definition);
    let stored = cells(&pool).cells(inserted).await.unwrap();
    assert_eq!(
        stored[&inserted[0]][&guests.name_definition],
        PropertyValue::Str("12".into())
    );
    assert_eq!(
        stored[&inserted[1]][&guests.name_definition],
        PropertyValue::Str("TBD".into())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_option_is_relabelled_and_recoloured_in_place(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let definitions = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let going = definitions
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options[0]
        .id;
    let before = version(&pool, guests.table_id).await;

    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.status,
                change: ColumnChange::UpdateOption {
                    option: OptionId::from_uuid(going),
                    label: Some("Attending".into()),
                    color: Some(Some(properties::TagColor::Pink.hex().into())),
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Column {
            table: guests.table_id,
            column: guests.status,
            table_version: TableVersion(before.0 + 1),
            change: ColumnResult::OptionUpdated,
        }]
    );
    let option = definitions
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options
        .remove(0);
    assert_eq!(
        (option.id, option.value, option.color),
        (
            going,
            PropertyOptionValue::String("Attending".into()),
            Some("#E93D82".into())
        )
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_removed_option_leaves_its_cells_empty_and_the_others_alone(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let inserted = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Column {
                    table: guests.table_id,
                    column: guests.status,
                    change: ColumnChange::AddOptions {
                        options: vec![NewOption {
                            id: OptionId::new(),
                            label: "Maybe".into(),
                        }],
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![
                            vec![CellWrite {
                                column: guests.status,
                                value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                            }],
                            vec![CellWrite {
                                column: guests.status,
                                value: CellValue::Options(vec![OptionRef::Label("Maybe".into())]),
                            }],
                        ],
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Column {
            change: ColumnResult::OptionsAdded { .. },
            ..
        },
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected the option then the insert, got {inserted:?}");
    };
    let definitions = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let options = definitions
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options;
    let (going, maybe) = (options[0].id, options[1].id);

    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.status,
                change: ColumnChange::DeleteOption {
                    option: OptionId::from_uuid(going),
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    let remaining: Vec<Uuid> = definitions
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options
        .iter()
        .map(|option| option.id)
        .collect();
    assert_eq!(remaining, vec![maybe]);
    let stored = cells(&pool).cells(inserted).await.unwrap();
    assert_eq!(
        stored
            .get(&inserted[0])
            .and_then(|row| row.get(&guests.status_definition)),
        None
    );
    assert_eq!(
        stored[&inserted[1]][&guests.status_definition],
        PropertyValue::SelectOption(vec![maybe])
    );
    let emptied = sqlx::query_scalar!(
        r#"SELECT values AS "values: serde_json::Value" FROM entity_properties
           WHERE entity_id = $1 AND property_definition_id = $2"#,
        inserted[0].to_string(),
        guests.status_definition,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(emptied, Some(serde_json::Value::Null));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_shared_property_is_editable_by_its_owner_alone(pool: PgPool) {
    use properties::domain::model::PropertyDefinitionOwner;
    use properties::domain::ports::PropertiesRepo;

    insert_user(&pool).await;
    insert_named_user(&pool, "macro|someone-else@macro.com").await;
    let properties = PropertiesPgRepo::new(pool.clone());
    let owner = MacroUserIdStr::parse_from_str(USER).unwrap();
    let someone_else = MacroUserIdStr::parse_from_str("macro|someone-else@macro.com").unwrap();
    let mine = properties
        .create_property_definition(
            PropertyDefinitionOwner::User(&owner),
            "Budget",
            DataType::SelectString,
            false,
            None,
            vec![],
        )
        .await
        .unwrap();
    let theirs = properties
        .create_property_definition(
            PropertyDefinitionOwner::User(&someone_else),
            "Budget",
            DataType::SelectString,
            false,
            None,
            vec![],
        )
        .await
        .unwrap();

    let editable = PgDefinitionStore::new(pool.clone(), properties)
        .editable_definitions(&viewer(), &[mine.id, theirs.id])
        .await
        .unwrap();

    assert_eq!(editable, vec![mine.id]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn appended_options_follow_the_existing_ones_in_place_and_colour(pool: PgPool) {
    let guests = guests(&pool).await;
    let before = version(&pool, guests.table_id).await;
    let maybe = OptionId::new();
    let declined = OptionId::new();

    let results = service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.status,
                change: ColumnChange::AddOptions {
                    options: vec![
                        NewOption {
                            id: maybe,
                            label: "Maybe".into(),
                        },
                        NewOption {
                            id: declined,
                            label: "Declined".into(),
                        },
                    ],
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Column {
            table: guests.table_id,
            column: guests.status,
            table_version: TableVersion(before.0 + 1),
            change: ColumnResult::OptionsAdded {
                added: vec![maybe, declined],
            },
        }]
    );
    let options = &PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[guests.status_definition])
        .await
        .unwrap()[0]
        .property_options;
    assert_eq!(
        options
            .iter()
            .skip(1)
            .map(|option| option.id)
            .collect::<Vec<_>>(),
        vec![maybe.into_uuid(), declined.into_uuid()]
    );
    let stored: Vec<(i32, PropertyOptionValue, Option<&str>)> = options
        .iter()
        .map(|option| {
            (
                option.display_order,
                option.value.clone(),
                option.color.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        stored,
        [
            (
                0,
                PropertyOptionValue::String("Going".into()),
                Some("#0091FF")
            ),
            (
                1,
                PropertyOptionValue::String("Maybe".into()),
                Some("#46A758")
            ),
            (
                2,
                PropertyOptionValue::String("Declined".into()),
                Some("#8E4EC6")
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_text_column_converts_into_a_new_number_column_and_keeps_its_rows(pool: PgPool) {
    use entity_access::domain::models::ViewAccessLevel;

    use crate::domain::models::{ColumnConversion, ConvertedCell};

    let guests = guests(&pool).await;
    let service = service(&pool);
    let inserted = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("1".into()),
                        }],
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("2".into()),
                        }],
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("soon".into()),
                        }],
                    ],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };
    let stored_names = || async {
        sqlx::query!(
            r#"SELECT id, entity_id, values AS "values: serde_json::Value", updated_at
               FROM entity_properties
               WHERE property_definition_id = $1
               ORDER BY entity_id"#,
            guests.name_definition,
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.id, row.entity_id, row.values, row.updated_at))
        .collect::<Vec<_>>()
    };
    let before = stored_names().await;
    assert_eq!(before.len(), 3);

    let conversion = service
        .column_conversion(
            EntityAccessReceipt::<ViewAccessLevel>::try_new_authenticated_user(
                MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
                Entity {
                    entity_id: guests.database_id.to_string(),
                    entity_type: EntityType::Database,
                },
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                },
            )
            .unwrap(),
            guests.table_id,
            guests.name,
            ColumnKind::Number,
        )
        .await
        .unwrap();
    assert_eq!(
        conversion,
        ColumnConversion {
            table_version: version(&pool, guests.table_id).await,
            options: vec![],
            cells: vec![
                ConvertedCell {
                    row: inserted[0],
                    value: CellValue::Number(1.0),
                },
                ConvertedCell {
                    row: inserted[1],
                    value: CellValue::Number(2.0),
                },
            ],
            misfits: 1,
        }
    );

    let count = ColumnId::new();
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            crate::domain::models::OpBatch {
                ops: vec![
                    DatabaseOp::Column {
                        table: guests.table_id,
                        column: count,
                        change: ColumnChange::Create {
                            definition: NewColumn::New {
                                name: "Count".into(),
                                kind: ColumnKind::Number,
                                options: vec![],
                                infer_type: false,
                            },
                            after: Some(guests.name),
                        },
                    },
                    DatabaseOp::Rows {
                        table: guests.table_id,
                        change: RowsChange::Update {
                            changes: RowChanges::PerRow {
                                rows: conversion
                                    .cells
                                    .into_iter()
                                    .map(|cell| RowChange {
                                        row: cell.row,
                                        cells: vec![CellWrite {
                                            column: count,
                                            value: cell.value,
                                        }],
                                    })
                                    .collect(),
                            },
                        },
                    },
                ],
                base_versions: std::collections::HashMap::from([(
                    guests.table_id,
                    conversion.table_version,
                )]),
            },
        )
        .await
        .unwrap();

    assert_eq!(stored_names().await, before);
    let count_definition = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[guests.table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|column| column.id == count)
        .unwrap()
        .property_definition_id;
    let stored = cells(&pool).cells(inserted).await.unwrap();
    assert_eq!(
        stored[&inserted[0]][&count_definition],
        PropertyValue::Num(1.0)
    );
    assert_eq!(
        stored[&inserted[1]][&count_definition],
        PropertyValue::Num(2.0)
    );
    assert!(!stored[&inserted[2]].contains_key(&count_definition));
    assert_eq!(
        stored[&inserted[2]][&guests.name_definition],
        PropertyValue::Str("soon".into())
    );
}
