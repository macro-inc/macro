//! Schema ops over Postgres: a batch's tables, columns, options and rows
//! commit in one transaction, minted ids are checked against every
//! database, and expected versions are checked under the batch's locks.

use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, NewView, PresenceOperator,
    RequestedLayout, SortDirection, SortKey, TextOperator, ViewId, ViewQuery,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, ColumnResult, DatabaseOp, NewColumn, NewOption,
    OpResult, OptionId, OptionRef, RowsChange, RowsResult, TableChange, TableResult, TakenId,
    ViewChange, ViewResult,
};
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;

use super::apply_ops::{cells, edit, guests, service, version, viewer};
use super::*;
use crate::domain::models::{DatabaseError, OpRefusal};
use crate::domain::ports::{DatabasesRepo, DatabasesService};
use crate::outbound::pg_definition_store::PgDefinitionStore;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn protected_schema_ops_are_refused_and_stale_writes_are_rechecked(pool: PgPool) {
    let guests = guests(&pool).await;
    // A write planned before the protection was registered must also be refused.
    let planned = Writes {
        database_id: guests.database_id,
        created_by: viewer().user_id,
        writes: vec![Write::DeleteColumn {
            table_id: guests.table_id,
            column_id: guests.name,
            definition_id: guests.name_definition,
            views: vec![],
            related: None,
        }],
        related_rows: vec![],
        expected_versions: vec![],
        journal: crate::domain::journal::JournalPlan::default(),
    };
    sqlx::query!(
        "INSERT INTO database_column_protections (column_id, capability) VALUES ($1, 'delete'), ($1, 'change_type')",
        guests.name.into_uuid()
    ).execute(&pool).await.unwrap();
    let before = version(&pool, guests.table_id).await;
    for change in [
        ColumnChange::Delete,
        ColumnChange::ChangeType {
            to: ColumnKind::Number,
        },
    ] {
        let result = service(&pool)
            .apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::Column {
                    table: guests.table_id,
                    column: guests.name,
                    change,
                }]
                .into(),
            )
            .await;
        assert!(
            matches!(result, Err(DatabaseError::InvalidOp(ref refusal)) if refusal.reason.contains("protected")),
            "{result:?}"
        );
    }
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    assert_eq!(
        store.apply_writes(&planned).await.unwrap(),
        WritesOutcome::ColumnProtected {
            write: 0,
            capability: crate::domain::models::ColumnProtection::Delete,
        }
    );
    assert_eq!(version(&pool, guests.table_id).await, before);
    let repository = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    assert!(
        repository
            .columns_for_tables(&[guests.table_id])
            .await
            .unwrap()
            .iter()
            .any(|column| column.id == guests.name)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_batch_creates_a_table_a_select_column_on_it_and_rows_filling_it(pool: PgPool) {
    let guests = guests(&pool).await;
    let before = version(&pool, guests.table_id).await;
    let hosts = TableId::new();
    let role = ColumnId::new();
    let (lead, crew) = (OptionId::new(), OptionId::new());

    let results = service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Table {
                    table: hosts,
                    change: TableChange::Create {
                        name: "Hosts".into(),
                    },
                },
                DatabaseOp::Column {
                    table: hosts,
                    column: role,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Role".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![
                                NewOption {
                                    id: lead,
                                    label: "Lead".into(),
                                },
                                NewOption {
                                    id: crew,
                                    label: "Crew".into(),
                                },
                            ],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Rows {
                    table: hosts,
                    change: RowsChange::Insert {
                        rows: vec![
                            vec![CellWrite {
                                column: role,
                                value: CellValue::Options(vec![OptionRef::Id(lead)]),
                            }],
                            vec![CellWrite {
                                column: role,
                                value: CellValue::Options(vec![OptionRef::Id(crew)]),
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
        OpResult::Table {
            table,
            table_version: Some(created),
            change: TableResult::Created,
        },
        OpResult::Column {
            column,
            table_version: placed,
            change: ColumnResult::Created,
            ..
        },
        OpResult::Rows {
            table_version: filled,
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a table, a column and two rows, got {results:?}");
    };
    assert_eq!((*table, *column), (hosts, role));
    assert_eq!(inserted.len(), 2);
    // A new table is versioned once by everything the batch did to it.
    assert_eq!(
        (*created, *placed, *filled),
        (TableVersion(1), TableVersion(1), TableVersion(1))
    );
    assert_eq!(version(&pool, hosts).await, TableVersion(1));
    assert_eq!(version(&pool, guests.table_id).await, before);

    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let (_, tables) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tables
            .iter()
            .map(|table| (table.id, table.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(guests.table_id, "Table 1"), (hosts, "Hosts")]
    );
    let columns = repo.columns_for_tables(&[hosts]).await.unwrap();
    assert_eq!(columns.len(), 1);
    assert_eq!(columns[0].id, role);
    let definition = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[columns[0].property_definition_id])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(definition.definition.display_name, "Role");
    assert_eq!(definition.definition.data_type, DataType::SelectString);
    assert_eq!(
        definition
            .property_options
            .iter()
            .map(|option| (option.id, option.value.clone()))
            .collect::<Vec<_>>(),
        vec![
            (lead.into_uuid(), PropertyOptionValue::String("Lead".into())),
            (crew.into_uuid(), PropertyOptionValue::String("Crew".into())),
        ]
    );
    assert_eq!(
        repo.row_refs(hosts)
            .await
            .unwrap()
            .iter()
            .map(|row| row.id)
            .collect::<Vec<_>>(),
        inserted.clone()
    );
    let stored = cells(&pool).cells(inserted).await.unwrap();
    assert_eq!(
        stored[&inserted[0]][&definition.definition.id],
        PropertyValue::SelectOption(vec![lead.into_uuid()])
    );
    assert_eq!(
        stored[&inserted[1]][&definition.definition.id],
        PropertyValue::SelectOption(vec![crew.into_uuid()])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_batch_refused_at_its_last_op_leaves_none_of_its_schema_behind(pool: PgPool) {
    let guests = guests(&pool).await;
    let before = version(&pool, guests.table_id).await;
    let definitions_before = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM property_definitions WHERE database_id = $1",
        guests.database_id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let hosts = TableId::new();
    let role = ColumnId::new();
    let lead = OptionId::new();
    let ghost = RowId::new();

    let error = service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Table {
                    table: hosts,
                    change: TableChange::Create {
                        name: "Hosts".into(),
                    },
                },
                DatabaseOp::Column {
                    table: hosts,
                    column: role,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Role".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![NewOption {
                                id: lead,
                                label: "Lead".into(),
                            }],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Delete { rows: vec![ghost] },
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
            op: 2,
            row: Some(0),
            column: None,
            taken: None,
            reason: format!("no row {ghost} in this table"),
        }
    );
    let (_, tables) = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tables.iter().map(|table| table.id).collect::<Vec<_>>(),
        vec![guests.table_id]
    );
    let columns = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM database_columns WHERE id = $1",
        role.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(columns, Some(0));
    let definitions_after = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM property_definitions WHERE database_id = $1",
        guests.database_id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(definitions_after, definitions_before);
    let options = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM property_options WHERE id = $1",
        lead.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(options, Some(0));
    assert_eq!(version(&pool, guests.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_table_id_another_database_already_has_is_refused_as_taken(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let elsewhere = service
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
        })
        .await
        .unwrap();
    let taken = repo.get_database(elsewhere.id).await.unwrap().unwrap().1[0].id;

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: taken,
                change: TableChange::Create {
                    name: "Hosts".into(),
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
            row: None,
            column: None,
            taken: Some(TakenId::Table(taken)),
            reason: format!(
                "{taken} already names a table; mint a new id for each table a request creates"
            ),
        }
    );
    let (_, tables) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tables.iter().map(|table| table.id).collect::<Vec<_>>(),
        vec![guests.table_id]
    );
    let (_, elsewhere_tables) = repo.get_database(elsewhere.id).await.unwrap().unwrap();
    assert_eq!(
        elsewhere_tables
            .iter()
            .map(|table| (table.id, table.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(taken, "Table 1")]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_option_id_another_definition_already_has_is_refused_as_taken(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let elsewhere = service
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
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
    let taken = OptionId::new();
    service
        .apply_ops(
            edit(elsewhere.id),
            viewer(),
            vec![DatabaseOp::Column {
                table: elsewhere_table,
                column: ColumnId::new(),
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Stage".into(),
                        kind: ColumnKind::Select { multi: false },
                        options: vec![NewOption {
                            id: taken,
                            label: "Maybe".into(),
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

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.status,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: taken,
                        label: "Maybe".into(),
                    }],
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
            row: None,
            column: None,
            taken: Some(TakenId::Option(taken)),
            reason: format!(
                "{taken} already names an option; mint a new id for each option a request creates"
            ),
        }
    );
    let options = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[guests.status_definition])
        .await
        .unwrap()
        .remove(0)
        .property_options;
    assert_eq!(
        options
            .iter()
            .map(|option| option.value.clone())
            .collect::<Vec<_>>(),
        vec![PropertyOptionValue::String("Going".into())]
    );
    assert_eq!(version(&pool, guests.table_id).await, before);
}

/// A view id is the client's to mint, like a table's: one another database's
/// view already has refuses the batch by the views' primary key, which the
/// planner cannot see from this database's schema.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_view_id_another_database_already_has_is_refused_as_taken(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let before = version(&pool, guests.table_id).await;
    let elsewhere = service
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
        })
        .await
        .unwrap();
    let elsewhere_table = repo.get_database(elsewhere.id).await.unwrap().unwrap().1[0].id;
    let taken = ViewId::new();
    service
        .apply_ops(
            edit(elsewhere.id),
            viewer(),
            vec![DatabaseOp::View {
                table: elsewhere_table,
                view: taken,
                change: ViewChange::Create {
                    view: NewView {
                        name: "Everything".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Table { columns: vec![] },
                    },
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: taken,
                change: ViewChange::Create {
                    view: NewView {
                        name: "Everyone".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Table { columns: vec![] },
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
            row: None,
            column: None,
            taken: Some(TakenId::View(taken)),
            reason: format!(
                "{taken} already names a view; mint a new id for each view a request creates"
            ),
        }
    );
    assert!(
        repo.views_for_tables(&[guests.table_id])
            .await
            .unwrap()
            .is_empty()
    );
    let elsewhere_views = repo.views_for_tables(&[elsewhere_table]).await.unwrap();
    assert_eq!(
        elsewhere_views
            .iter()
            .map(|view| (view.id, view.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(taken, "Everything")]
    );
    assert_eq!(version(&pool, guests.table_id).await, before);
}

/// The service refuses a stale base version before it plans; the store
/// checks again under the table locks, which a concurrent batch may have
/// moved past in between.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stale_expected_version_conflicts_and_writes_nothing(pool: PgPool) {
    let guests = guests(&pool).await;
    let before = version(&pool, guests.table_id).await;
    let hosts = TableId::new();

    let outcome = cells(&pool)
        .apply_writes(&Writes {
            database_id: guests.database_id,
            created_by: viewer().user_id,
            writes: vec![
                Write::CreateTable {
                    table_id: hosts,
                    name: "Hosts".into(),
                },
                Write::RenameTable {
                    table_id: guests.table_id,
                    from: "Table 1".into(),
                    name: "Guests".into(),
                },
            ],
            related_rows: Vec::new(),
            expected_versions: vec![(guests.table_id, TableVersion(before.0 - 1))],
            journal: crate::domain::journal::JournalPlan::default(),
        })
        .await
        .unwrap();

    assert_eq!(outcome, WritesOutcome::VersionConflict(guests.table_id));
    let (_, tables) = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tables
            .iter()
            .map(|table| (table.id, table.name.as_str(), table.version))
            .collect::<Vec<_>>(),
        vec![(guests.table_id, "Table 1", before)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_type_change_converts_stored_cells_and_rewrites_views_testing_the_column(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let written = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![
                            vec![CellWrite {
                                column: guests.name,
                                value: CellValue::Text("12".into()),
                            }],
                            vec![CellWrite {
                                column: guests.name,
                                value: CellValue::Text("7".into()),
                            }],
                        ],
                    },
                },
                DatabaseOp::View {
                    table: guests.table_id,
                    view: ViewId::new(),
                    change: ViewChange::Create {
                        view: NewView {
                            name: "Ones".into(),
                            query: ViewQuery {
                                filter: Some(FilterGroup {
                                    conjunction: Conjunction::And,
                                    conditions: vec![
                                        FilterNode::Condition(FilterCondition {
                                            column: guests.name,
                                            test: FilterTest::Text {
                                                operator: TextOperator::Contains,
                                                value: "1".into(),
                                            },
                                        }),
                                        FilterNode::Condition(FilterCondition {
                                            column: guests.status,
                                            test: FilterTest::Presence {
                                                operator: PresenceOperator::IsNotEmpty,
                                            },
                                        }),
                                    ],
                                }),
                                sort: vec![SortKey {
                                    column: guests.name,
                                    direction: SortDirection::Ascending,
                                }],
                            },
                            layout: RequestedLayout::Table { columns: vec![] },
                        },
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
        OpResult::View {
            change: ViewResult::Created { view },
            ..
        },
    ] = written.as_slice()
    else {
        panic!("expected an insert and a view, got {written:?}");
    };
    let before = version(&pool, guests.table_id).await;

    let results = service
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
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Column {
            table: guests.table_id,
            column: guests.name,
            table_version: TableVersion(before.0 + 1),
            change: ColumnResult::TypeChanged,
        }]
    );
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let number = repo
        .columns_for_tables(&[guests.table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|column| column.id == guests.name)
        .unwrap()
        .property_definition_id;
    assert_ne!(number, guests.name_definition);
    let definition = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[number])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(definition.definition.data_type, DataType::Number);
    let stored = cells(&pool).cells(inserted).await.unwrap();
    assert_eq!(stored[&inserted[0]][&number], PropertyValue::Num(12.0));
    assert_eq!(stored[&inserted[1]][&number], PropertyValue::Num(7.0));
    let text_cells = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_properties WHERE property_definition_id = $1",
        guests.name_definition
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(text_cells, Some(0));
    let views = repo.views_for_tables(&[guests.table_id]).await.unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].id, view.id);
    assert_eq!(
        views[0].query,
        ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![FilterNode::Condition(FilterCondition {
                    column: guests.status,
                    test: FilterTest::Presence {
                        operator: PresenceOperator::IsNotEmpty,
                    },
                })],
            }),
            sort: vec![SortKey {
                column: guests.name,
                direction: SortDirection::Ascending,
            }],
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn protected_columns_refuse_direct_sql_but_allow_parent_deletion(pool: PgPool) {
    let guests = guests(&pool).await;
    sqlx::query!("INSERT INTO database_column_protections (column_id, capability) VALUES ($1, 'delete'), ($1, 'change_type')", guests.name.into_uuid()).execute(&pool).await.unwrap();
    let error = sqlx::query!(
        "DELETE FROM database_columns WHERE id = $1",
        guests.name.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().constraint(),
        Some("database_column_protected")
    );
    let error = sqlx::query!(
        "UPDATE property_definitions SET data_type = 'NUMBER' WHERE id = $1",
        guests.name_definition
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().constraint(),
        Some("database_column_protected")
    );
    sqlx::query!(
        "UPDATE database_columns SET display_name = 'Renamed' WHERE id = $1",
        guests.name.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM database_entities WHERE database_id = $1",
        guests.database_id.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_derived_column_stores_its_formula_and_keeps_its_definition_across_edits(pool: PgPool) {
    use crate::domain::models::ColumnConfig;
    use models_databases::{Formula, Operator};
    let guests = guests(&pool).await;
    let (seats, doubled) = (ColumnId::new(), ColumnId::new());
    let times = |factor: f64| Formula::Binary {
        operator: Operator::Multiply,
        left: Box::new(Formula::Column { column: seats }),
        right: Box::new(Formula::Number { value: factor }),
    };
    service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Column {
                    table: guests.table_id,
                    column: seats,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Seats".into(),
                            kind: ColumnKind::Number,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: guests.table_id,
                    column: doubled,
                    change: ColumnChange::Create {
                        definition: NewColumn::Derived {
                            name: "Doubled".into(),
                            formula: times(2.0),
                        },
                        after: None,
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let repository = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let stored = |columns: Vec<crate::domain::models::Column>| {
        columns
            .into_iter()
            .find(|column| column.id == doubled)
            .unwrap()
    };
    let created = stored(
        repository
            .columns_for_tables(&[guests.table_id])
            .await
            .unwrap(),
    );
    assert_eq!(
        created.config,
        Some(ColumnConfig::Derived {
            formula: times(2.0)
        })
    );

    let results = service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: doubled,
                change: ColumnChange::SetFormula {
                    formula: times(3.0),
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    assert!(matches!(
        results.as_slice(),
        [OpResult::Column {
            change: ColumnResult::FormulaSet,
            ..
        }]
    ));
    let edited = stored(
        repository
            .columns_for_tables(&[guests.table_id])
            .await
            .unwrap(),
    );
    assert_eq!(
        edited.config,
        Some(ColumnConfig::Derived {
            formula: times(3.0)
        })
    );
    assert_eq!(
        edited.property_definition_id,
        created.property_definition_id
    );
}
