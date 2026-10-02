//! Table ops over Postgres: names, removal, and the database's lock.

use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, DatabaseOp, NewColumn, OpResult, RowsChange,
    TableChange, TableResult,
};

use super::apply_ops::{edit, guests, service, version, viewer};
use super::*;
use crate::domain::models::{DatabaseError, OpRefusal, SchemaError};
use crate::domain::ports::{DatabasesRepo, DatabasesService};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn table_ops_wait_for_a_concurrent_trash_and_then_find_the_database_gone(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let mut trash = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE databases SET trashed_at = now() WHERE id = $1",
        guests.database_id.into_uuid(),
    )
    .execute(&mut *trash)
    .await
    .unwrap();
    let mut writes = std::pin::pin!(async {
        tokio::join!(
            service.apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::Table {
                    table: TableId::new(),
                    change: TableChange::Create {
                        name: "Blocked".into()
                    }
                }]
                .into(),
            ),
            service.apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::Table {
                    table: guests.table_id,
                    change: TableChange::Rename {
                        name: "Blocked rename".into(),
                        previous_name: None
                    }
                }]
                .into(),
            ),
        )
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut writes)
            .await
            .is_err(),
        "table writes must wait for the concurrent parent mutation"
    );
    trash.commit().await.unwrap();
    let (created, renamed) = writes.await;
    assert!(matches!(created.unwrap_err(), DatabaseError::NotFound));
    assert!(matches!(renamed.unwrap_err(), DatabaseError::NotFound));
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let (database, tables) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert!(database.trashed_at.is_some());
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "Table 1");
    assert_eq!(tables[0].version, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_database_is_not_found_rather_than_a_name_conflict_or_storage_error(
    pool: PgPool,
) {
    let (repo, table, _) = fixture(&pool).await;
    repo.delete_database(table.database_id).await.unwrap();
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    for write in [
        Write::CreateTable {
            table_id: TableId::new(),
            name: "Missing".into(),
        },
        Write::RenameTable {
            table_id: table.id,
            from: "Guests".into(),
            name: "Missing".into(),
        },
    ] {
        let outcome = store
            .apply_writes(&Writes {
                database_id: table.database_id,
                created_by: user(),
                writes: vec![write],
                related_rows: Vec::new(),
                expected_versions: Vec::new(),
                journal: crate::domain::journal::JournalPlan::default(),
                creates: None,
            })
            .await
            .unwrap();
        assert!(
            matches!(outcome, WritesOutcome::TableNotFound(_)),
            "expected the database to be gone, got {outcome:?}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_table_takes_its_rows_and_columns_but_never_the_last_table(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let sessions = TableId::new();
    let topic = ColumnId::new();
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
                    table: sessions,
                    column: topic,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Topic".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Rows {
                    table: sessions,
                    change: RowsChange::Insert {
                        rows: vec![
                            vec![CellWrite {
                                column: topic,
                                value: CellValue::Text("Keynote".into()),
                            }],
                            vec![],
                        ],
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();

    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: sessions,
                change: TableChange::Delete,
            }]
            .into(),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Table {
            table: sessions,
            table_version: None,
            change: TableResult::Deleted,
        }]
    );
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    assert!(repo.row_refs(sessions).await.unwrap().is_empty());
    assert!(
        repo.columns_for_tables(&[sessions])
            .await
            .unwrap()
            .is_empty()
    );
    let (_, tables) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["Table 1"]
    );

    let again = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: sessions,
                change: TableChange::Delete,
            }]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = again else {
        panic!("expected a refused op, got {again:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: None,
            column: None,
            taken: None,
            reason: format!("table {sessions} is not in this database"),
        }
    );
    let last = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: guests.table_id,
                change: TableChange::Delete,
            }]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = last else {
        panic!("expected a refused op, got {last:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: None,
            column: None,
            taken: None,
            reason: SchemaError::LastTable.to_string(),
        }
    );
    assert_eq!(
        repo.get_database(guests.database_id)
            .await
            .unwrap()
            .unwrap()
            .1
            .len(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_table_rename_checks_its_previous_name_and_other_tables_names(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let hosts = TableId::new();
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: hosts,
                change: TableChange::Create {
                    name: "Hosts".into(),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let before = version(&pool, hosts).await;

    let taken = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: hosts,
                change: TableChange::Rename {
                    name: "table 1".into(),
                    previous_name: Some("Hosts".into()),
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = taken else {
        panic!("expected a refused op, got {taken:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::TableNameTaken {
            name: "table 1".into()
        }
        .to_string()
    );

    let renamed = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: hosts,
                change: TableChange::Rename {
                    name: "Attendees".into(),
                    previous_name: Some("Hosts".into()),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    assert_eq!(
        renamed,
        vec![OpResult::Table {
            table: hosts,
            table_version: Some(TableVersion(before.0 + 1)),
            change: TableResult::Renamed,
        }]
    );

    let stale = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: hosts,
                change: TableChange::Rename {
                    name: "People".into(),
                    previous_name: Some("Hosts".into()),
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = stale else {
        panic!("expected a refused op, got {stale:?}");
    };
    assert_eq!(refusal.reason, SchemaError::TableRenameConflict.to_string());
    let (_, tables) = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    let stored = tables.iter().find(|table| table.id == hosts).unwrap();
    assert_eq!(stored.name, "Attendees");
    assert_eq!(stored.version, TableVersion(before.0 + 1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_concurrent_table_create_and_rename_cannot_take_the_same_name(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);

    let (renamed, created) = tokio::join!(
        service.apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: guests.table_id,
                change: TableChange::Rename {
                    name: "People".into(),
                    previous_name: Some("Table 1".into())
                }
            }]
            .into(),
        ),
        service.apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: TableId::new(),
                change: TableChange::Create {
                    name: "people".into()
                }
            }]
            .into(),
        ),
    );

    assert_ne!(renamed.is_ok(), created.is_ok());
    let (_, tables) = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        tables
            .iter()
            .filter(|table| table.name.eq_ignore_ascii_case("people"))
            .count(),
        1
    );
    let again = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: TableId::new(),
                change: TableChange::Create {
                    name: "people".into(),
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(again, DatabaseError::InvalidOp(OpRefusal { op: 0, .. })),
        "expected the name to be taken, got {again:?}"
    );
}
