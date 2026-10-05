use super::*;

#[tokio::test]
async fn label_rename_preserves_the_binding_moves_the_sql_name_and_retries_idempotently() {
    let seeded = seeded().await;
    let (world, svc, db, table_id, row_id, column) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
        seeded.name_column,
    );
    let before = table_version(&world, table_id);
    let rename = |name: &str| {
        OpBatch::from(vec![DatabaseOp::Column {
            table: table_id,
            column: column.id,
            change: ColumnChange::Rename {
                name: name.into(),
                previous_name: Some("Name".into()),
            },
        }])
    };
    let results = svc
        .apply_ops(edit(db), viewer(OWNER), rename("  Task  "))
        .await
        .unwrap();
    let renamed_version = TableVersion(before.0 + 1);
    assert_eq!(
        results,
        vec![OpResult::Column {
            table: table_id,
            column: column.id,
            table_version: renamed_version,
            change: ColumnResult::Renamed,
        }]
    );
    assert_eq!(
        world.lock().unwrap().published.last(),
        Some(&(table_id, renamed_version))
    );

    // The cell stays where it was: the label moved, the binding did not.
    assert_eq!(
        cell(&world, row_id, column.property_definition_id),
        Some(PropertyValue::Str("Sam".into()))
    );
    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, VIEWER, AccessLevel::View))
        .await
        .unwrap();
    let renamed = detail.tables[0]
        .columns
        .iter()
        .find(|entry| entry.column.id == column.id)
        .unwrap();
    assert_eq!(
        renamed.column.property_definition_id,
        column.property_definition_id
    );
    assert_eq!(renamed.sql_name, "\"Task\"");
    assert_eq!(renamed.definition.definition.display_name, "Name");
    assert_eq!(renamed.column.display_name.as_deref(), Some("Task"));

    let retried = svc
        .apply_ops(edit(db), viewer(OWNER), rename("Task"))
        .await
        .unwrap();
    assert_eq!(
        retried,
        vec![OpResult::Column {
            table: table_id,
            column: column.id,
            table_version: renamed_version,
            change: ColumnResult::Renamed,
        }]
    );
    let error = svc
        .apply_ops(edit(db), viewer(OWNER), rename("Work item"))
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::ColumnRenamedElsewhere.to_string()
    );
    assert_eq!(
        world
            .lock()
            .unwrap()
            .columns
            .iter()
            .find(|candidate| candidate.id == column.id)
            .unwrap()
            .display_name
            .as_deref(),
        Some("Task")
    );
}

#[tokio::test]
async fn rename_checks_effective_labels_and_creation_respects_renamed_labels() {
    let seeded = seeded().await;
    let (svc, db, table_id, name_column, status_column) = (
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.name_column,
        seeded.status_column,
    );
    for (invalid, reason) in [
        (" ".to_string(), SchemaError::EmptyName.to_string()),
        (
            " status ".to_string(),
            SchemaError::ColumnLabelTaken.to_string(),
        ),
        (
            "x".repeat(201),
            SchemaError::NameTooLong { max: 200 }.to_string(),
        ),
    ] {
        let error = svc
            .apply_ops(
                edit(db),
                viewer(OWNER),
                OpBatch::from(vec![DatabaseOp::Column {
                    table: table_id,
                    column: name_column.id,
                    change: ColumnChange::Rename {
                        name: invalid.clone(),
                        previous_name: Some("Name".into()),
                    },
                }]),
            )
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = error else {
            panic!("{invalid}: expected a refused op, got {error:?}");
        };
        assert_eq!(refusal.reason, reason, "{invalid}");
    }
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: table_id,
            column: name_column.id,
            change: ColumnChange::Rename {
                name: "Task".into(),
                previous_name: Some("Name".into()),
            },
        }]),
    )
    .await
    .unwrap();
    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: table_id,
                column: status_column.id,
                change: ColumnChange::Rename {
                    name: " task ".into(),
                    previous_name: Some("Status".into()),
                },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(refusal.reason, SchemaError::ColumnLabelTaken.to_string());
    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: table_id,
                column: ColumnId::new(),
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: " TASK ".into(),
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
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::ColumnNameTaken {
            name: "TASK".into()
        }
        .to_string()
    );
}

#[tokio::test]
async fn rename_refuses_foreign_columns_tables_and_trashed_database() {
    let seeded = seeded().await;
    let (world, svc, db, table_id, column) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.name_column,
    );
    let other = svc
        .create_database(CreateDatabase {
            name: "Other".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    let elsewhere = TableId::new();
    let missing = ColumnId::new();
    for (receipt_db, target_table, target_column, reason) in [
        (
            other.id,
            table_id,
            column.id,
            format!("table {table_id} is not in this database"),
        ),
        (
            db,
            elsewhere,
            column.id,
            format!("table {elsewhere} is not in this database"),
        ),
        (
            db,
            table_id,
            missing,
            "no such column in this table".to_string(),
        ),
    ] {
        let error = svc
            .apply_ops(
                edit(receipt_db),
                viewer(OWNER),
                OpBatch::from(vec![DatabaseOp::Column {
                    table: target_table,
                    column: target_column,
                    change: ColumnChange::Rename {
                        name: "Task".into(),
                        previous_name: Some("Name".into()),
                    },
                }]),
            )
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = error else {
            panic!("expected a refused op, got {error:?}");
        };
        assert_eq!(refusal.reason, reason);
    }
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: table_id,
                column: column.id,
                change: ColumnChange::Rename {
                    name: "Task".into(),
                    previous_name: Some("Name".into()),
                },
            }]),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound), "{error:?}");
    assert!(
        world
            .lock()
            .unwrap()
            .columns
            .iter()
            .find(|candidate| candidate.id == column.id)
            .unwrap()
            .display_name
            .is_none()
    );
}

#[tokio::test]
async fn reusing_a_previous_label_keeps_the_renamed_columns_values_intact() {
    let seeded = seeded().await;
    let (world, svc, db, table_id, row_id, column) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
        seeded.name_column,
    );
    let added_id = ColumnId::new();
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![
            DatabaseOp::Column {
                table: table_id,
                column: column.id,
                change: ColumnChange::Rename {
                    name: "Task".into(),
                    previous_name: Some("Name".into()),
                },
            },
            DatabaseOp::Column {
                table: table_id,
                column: added_id,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Name".into(),
                        kind: ColumnKind::Text,
                        options: vec![],
                        infer_type: false,
                    },
                    after: None,
                },
            },
        ]),
    )
    .await
    .unwrap();
    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::View))
        .await
        .unwrap();
    let columns = &detail.tables[0].columns;
    let renamed = columns
        .iter()
        .find(|entry| entry.column.id == column.id)
        .unwrap();
    let added = columns
        .iter()
        .find(|entry| entry.column.id == added_id)
        .unwrap();
    assert_eq!(renamed.sql_name, "\"Task\"");
    assert_eq!(renamed.column.display_name.as_deref(), Some("Task"));
    assert_eq!(added.sql_name, "\"Name\"");
    assert_eq!(added.definition.definition.display_name, "Name");
    assert_ne!(
        added.definition.definition.id,
        renamed.definition.definition.id
    );

    // The old label now names the new, empty column; the value stayed with
    // the renamed one.
    assert_eq!(
        cell(&world, row_id, renamed.definition.definition.id),
        Some(PropertyValue::Str("Sam".into()))
    );
    assert_eq!(cell(&world, row_id, added.definition.definition.id), None);
}
