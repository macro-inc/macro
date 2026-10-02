//! Database lifecycle and schema operations: create, list, rename, trash,
//! restore, delete, and the receipts they take.

use super::*;

#[tokio::test]
async fn create_database_grants_owner_and_starter_table() {
    let world: Shared = Arc::default();
    let svc = service(&world);
    let db = svc
        .create_database(CreateDatabase {
            name: "  Offsite ".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    assert_eq!(db.name, "Offsite");
    let listed = svc.list_databases(viewer(OWNER)).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].grant, AccessLevel::Owner);
    assert_eq!(listed[0].tables.len(), 1);
    assert_eq!(listed[0].tables[0].name, "Table 1");
    assert!(
        svc.list_databases(viewer(STRANGER))
            .await
            .unwrap()
            .is_empty()
    );
    {
        let world_state = world.lock().unwrap();
        assert_eq!(world_state.tables.len(), 1);
        assert_eq!(world_state.tables[0].name, "Table 1");
        assert_eq!(world_state.tables[0].database_id, db.id);
    }
    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db.id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let columns = &detail.tables[0].columns;
    assert_eq!(columns.len(), 1, "one request yields a usable table");
    assert_eq!(columns[0].name(), "Name");
    assert_eq!(columns[0].definition.definition.data_type, DataType::String);
    assert!(!columns[0].definition.definition.is_multi_select);
    assert!(!columns[0].shared_outside_database);

    let err = svc
        .create_database(CreateDatabase {
            name: "   ".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::InvalidSchemaOperation(_)));
}

#[tokio::test]
async fn database_details_answer_every_live_database_the_viewer_holds_a_grant_on() {
    let seeded = seeded().await;
    let (svc, offsite, guests) = (seeded.service, seeded.database_id, seeded.table_id);
    let sessions = TableId::new();
    svc.apply_ops(
        edit(offsite),
        viewer(OWNER),
        OpBatch::from(vec![
            DatabaseOp::Table {
                table: sessions,
                change: TableChange::Create {
                    name: "Sessions".into(),
                },
            },
            DatabaseOp::ReorderTables {
                order: vec![sessions, guests],
            },
        ]),
    )
    .await
    .unwrap();
    let venue = svc
        .create_database(CreateDatabase {
            name: "Venue".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    let archive = svc
        .create_database(CreateDatabase {
            name: "Archive".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    svc.trash_database(receipt::<OwnerAccessLevel>(
        archive.id,
        OWNER,
        AccessLevel::Owner,
    ))
    .await
    .unwrap();

    let details = svc.database_details(viewer(OWNER)).await.unwrap();
    assert_eq!(
        details
            .iter()
            .map(|detail| (detail.database.name.as_str(), detail.grant))
            .collect::<Vec<_>>(),
        vec![
            ("Offsite", AccessLevel::Owner),
            ("Venue", AccessLevel::Owner)
        ],
        "the trashed Archive is left out"
    );
    assert_eq!(
        details[0]
            .tables
            .iter()
            .map(|table| table.table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Sessions", "Guests"]
    );
    assert!(details[0].tables[0].columns.is_empty());
    assert_eq!(
        details[0].tables[1]
            .columns
            .iter()
            .map(|column| column.definition.definition.display_name.as_str())
            .collect::<Vec<_>>(),
        vec!["Name", "Status", "Plus ones"]
    );
    assert_eq!(details[1].database.id, venue.id);
    assert_eq!(details[1].tables[0].table.name, "Table 1");

    let shared = svc.database_details(viewer(VIEWER)).await.unwrap();
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0].database.id, offsite);
    assert_eq!(shared[0].grant, AccessLevel::View);
    assert_eq!(
        shared[0]
            .tables
            .iter()
            .map(|table| table.table.id)
            .collect::<Vec<_>>(),
        vec![sessions, guests]
    );

    assert!(
        svc.database_details(viewer(STRANGER))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn rename_validates_the_name_and_writes_it() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);

    let renamed = svc
        .rename_database(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            "  Winter Offsite  ".into(),
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "Winter Offsite");
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
            receipt::<EditAccessLevel>(DatabaseId::new(), OWNER, AccessLevel::Owner),
            "Elsewhere".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));
}

#[tokio::test]
async fn table_rename_moves_the_sql_name_and_retries_without_overwriting_a_new_name() {
    let seeded = seeded().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let before = table_version(&world, table_id);
    let rename = |name: &str| {
        OpBatch::from(vec![DatabaseOp::Table {
            table: table_id,
            change: TableChange::Rename {
                name: name.into(),
                previous_name: Some("Guests".into()),
            },
        }])
    };
    let renamed = svc
        .apply_ops(edit(db), viewer(OWNER), rename("  Attendees  "))
        .await
        .unwrap();
    let renamed_version = TableVersion(before.0 + 1);
    assert_eq!(
        renamed,
        vec![OpResult::Table {
            table: table_id,
            table_version: Some(renamed_version),
            change: TableResult::Renamed,
        }]
    );
    assert_eq!(
        world.lock().unwrap().published.last(),
        Some(&(table_id, renamed_version))
    );

    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(detail.tables[0].table.name, "Attendees");
    assert_eq!(detail.tables[0].sql_name, "\"Offsite\".\"Attendees\"");

    let retried = svc
        .apply_ops(edit(db), viewer(OWNER), rename("Attendees"))
        .await
        .unwrap();
    assert_eq!(retried, renamed);
    let error = svc
        .apply_ops(edit(db), viewer(OWNER), rename("People"))
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(refusal.reason, SchemaError::TableRenameConflict.to_string());
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
    let seeded = seeded().await;
    let (svc, db, table_id) = (seeded.service, seeded.database_id, seeded.table_id);
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Table {
            table: TableId::new(),
            change: TableChange::Create {
                name: "People".into(),
            },
        }]),
    )
    .await
    .unwrap();
    let rename = |name: &str| {
        OpBatch::from(vec![DatabaseOp::Table {
            table: table_id,
            change: TableChange::Rename {
                name: name.into(),
                previous_name: Some("Guests".into()),
            },
        }])
    };
    for (name, reason) in [
        (" ", SchemaError::EmptyName.to_string()),
        (
            " people ",
            SchemaError::TableNameTaken {
                name: "people".into(),
            }
            .to_string(),
        ),
    ] {
        let error = svc
            .apply_ops(edit(db), viewer(OWNER), rename(name))
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = error else {
            panic!("{name}: expected a refused op, got {error:?}");
        };
        assert_eq!(refusal.reason, reason, "{name}");
    }
    let other = svc
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    let error = svc
        .apply_ops(edit(other.id), viewer(OWNER), rename("People"))
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        format!("table {table_id} is not in this database")
    );
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let error = svc
        .apply_ops(edit(db), viewer(OWNER), rename("People"))
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound), "{error:?}");
}

#[tokio::test]
async fn trash_hides_the_database_and_restore_brings_it_back() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);

    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let trashed_at = world.lock().unwrap().databases[0].trashed_at;
    assert!(trashed_at.is_some());

    // A trashed database is invisible to listing, reads, ops, and renames.
    assert!(svc.list_databases(viewer(OWNER)).await.unwrap().is_empty());
    let err = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));
    let err = svc
        .apply_ops(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Delete {
                    rows: vec![seeded.row_id],
                },
            }]),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound), "{err:?}");
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
async fn permanent_delete_removes_the_database_its_rows_and_its_grants() {
    let seeded = seeded().await;
    let (world, svc, db, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.row_id,
    );

    svc.delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    {
        let w = world.lock().unwrap();
        assert!(w.databases.is_empty());
        assert!(w.tables.is_empty());
        assert!(w.rows.is_empty());
        assert!(!w.cells.contains_key(&row_id));
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
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    svc.delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    assert!(world.lock().unwrap().databases.is_empty());
}

#[tokio::test]
async fn schema_operations_respect_receipts() {
    let seeded = seeded().await;
    let (svc, db, table_id) = (seeded.service, seeded.database_id, seeded.table_id);
    let err = svc
        .apply_ops(
            edit(DatabaseId::new()),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: table_id,
                column: ColumnId::new(),
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "X".into(),
                        kind: ColumnKind::Text,
                        options: vec![],
                        infer_type: false,
                    },
                    after: None,
                },
            }]),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, DatabaseError::NotFound),
        "a table outside the receipted database looks missing"
    );

    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, VIEWER, AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(detail.grant, AccessLevel::View);
    assert_eq!(detail.tables.len(), 1);
    assert_eq!(detail.tables[0].sql_name, "\"Offsite\".\"Guests\"");
    assert_eq!(
        detail.tables[0]
            .columns
            .iter()
            .map(|column| column.sql_name.as_str())
            .collect::<Vec<_>>(),
        vec!["\"Name\"", "\"Status\"", "\"Plus ones\""]
    );
    assert!(detail.tables[0].columns.iter().all(|c| !c.writable));

    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(detail.grant, AccessLevel::Owner);
    assert!(detail.tables[0].columns.iter().all(|c| c.writable));
}
