use super::*;

#[tokio::test]
async fn number_text_conversion_writes_converted_cells_through_the_cell_store() {
    let seeded = seeded().await;
    let (world, svc, db, table_id, row_id, plus_ones) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
        seeded.plus_ones_column,
    );
    let old = plus_ones.property_definition_id;
    let seeded_version = table_version(&world, table_id);
    let results = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: table_id,
                    column: plus_ones.id,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Text,
                    },
                }],
                base_versions: HashMap::from([(table_id, seeded_version)]),
            },
        )
        .await
        .unwrap();
    let as_text_version = TableVersion(seeded_version.0 + 1);
    assert_eq!(
        results,
        vec![OpResult::Column {
            table: table_id,
            column: plus_ones.id,
            table_version: as_text_version,
            change: ColumnResult::TypeChanged,
        }]
    );
    let as_text = {
        let w = world.lock().unwrap();
        let column = w.columns.iter().find(|c| c.id == plus_ones.id).unwrap();
        assert_ne!(column.property_definition_id, old);
        assert!(!column.infer_type);
        assert_eq!(w.definitions[&old].definition.data_type, DataType::Number);
        assert_eq!(
            w.definitions[&column.property_definition_id]
                .definition
                .data_type,
            DataType::String
        );
        assert_eq!(
            w.definitions[&column.property_definition_id]
                .definition
                .display_name,
            "Plus ones"
        );
        assert_eq!(
            w.cells[&row_id][&column.property_definition_id],
            PropertyValue::Str("2".into())
        );
        assert!(
            !w.cells[&row_id].contains_key(&old),
            "rebinding the column clears the old definition's cells"
        );
        assert_eq!(w.published.last(), Some(&(table_id, as_text_version)));
        column.property_definition_id
    };
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch {
            ops: vec![DatabaseOp::Column {
                table: table_id,
                column: plus_ones.id,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Number,
                },
            }],
            base_versions: HashMap::from([(table_id, as_text_version)]),
        },
    )
    .await
    .unwrap();
    let w = world.lock().unwrap();
    let column = w.columns.iter().find(|c| c.id == plus_ones.id).unwrap();
    assert_ne!(column.property_definition_id, as_text);
    assert_eq!(
        w.cells[&row_id][&column.property_definition_id],
        PropertyValue::Num(2.0)
    );
    assert!(w.definitions.contains_key(&as_text));
}

#[tokio::test]
async fn invalid_or_lossy_conversions_do_not_modify_the_column() {
    for value in ["0012", "9007199254740993", "2.00", " 2", "hello"] {
        let seeded = seeded().await;
        let (world, svc, db, table_id, row_id, name) = (
            seeded.world,
            seeded.service,
            seeded.database_id,
            seeded.table_id,
            seeded.row_id,
            seeded.name_column,
        );
        let old = name.property_definition_id;
        let before = table_version(&world, table_id);
        world
            .lock()
            .unwrap()
            .cells
            .get_mut(&row_id)
            .unwrap()
            .insert(old, PropertyValue::Str(value.into()));
        let result = svc
            .apply_ops(
                edit(db),
                viewer(OWNER),
                OpBatch::from(vec![DatabaseOp::Column {
                    table: table_id,
                    column: name.id,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Number,
                    },
                }]),
            )
            .await;
        assert!(
            matches!(result, Err(DatabaseError::InvalidOp(_))),
            "{value}: {result:?}"
        );
        let w = world.lock().unwrap();
        assert_eq!(w.definitions.len(), 3);
        assert_eq!(w.tables[0].version, before);
        assert_eq!(
            w.columns
                .iter()
                .find(|c| c.id == name.id)
                .unwrap()
                .property_definition_id,
            old
        );
        assert_eq!(w.cells[&row_id][&old], PropertyValue::Str(value.into()));
    }
}

#[tokio::test]
async fn selecting_text_preserves_option_labels_and_select_preserves_unused_options() {
    let seeded = seeded().await;
    let (world, svc, db, table_id, row_id, status) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
        seeded.status_column,
    );
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: table_id,
            column: status.id,
            change: ColumnChange::ChangeType {
                to: ColumnKind::Select { multi: true },
            },
        }]),
    )
    .await
    .unwrap();
    {
        let w = world.lock().unwrap();
        let column = w.columns.iter().find(|c| c.id == status.id).unwrap();
        let definition = &w.definitions[&column.property_definition_id];
        assert!(definition.definition.is_multi_select);
        assert_eq!(
            catalog::option_labels(definition)
                .into_iter()
                .map(|(_, label)| label)
                .collect::<Vec<_>>(),
            vec!["Going", "Declined"]
        );
        let going = definition.property_options[0].id;
        assert_eq!(
            w.cells[&row_id][&column.property_definition_id],
            PropertyValue::SelectOption(vec![going])
        );
    }
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: table_id,
            column: status.id,
            change: ColumnChange::ChangeType {
                to: ColumnKind::Text,
            },
        }]),
    )
    .await
    .unwrap();
    let w = world.lock().unwrap();
    let column = w.columns.iter().find(|c| c.id == status.id).unwrap();
    assert_eq!(
        w.cells[&row_id][&column.property_definition_id],
        PropertyValue::Str("Going".into())
    );
}

#[tokio::test]
async fn reorder_validates_complete_ids_and_delete_preserves_definitions() {
    let seeded = seeded().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let ids = [
        seeded.name_column.id,
        seeded.status_column.id,
        seeded.plus_ones_column.id,
    ];
    let seeded_version = table_version(&world, table_id);
    for invalid in [
        vec![],
        vec![ids[0]; 3],
        vec![ColumnId::new(); 3],
        vec![ids[0], ids[1]],
    ] {
        let error = svc
            .apply_ops(
                edit(db),
                viewer(OWNER),
                OpBatch {
                    ops: vec![DatabaseOp::Table {
                        table: table_id,
                        change: TableChange::ReorderColumns { order: invalid },
                    }],
                    base_versions: HashMap::from([(table_id, seeded_version)]),
                },
            )
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = error else {
            panic!("expected a refused op, got {error:?}");
        };
        assert_eq!(
            refusal.reason,
            SchemaError::IncompleteColumnOrder.to_string()
        );
    }
    let reordered = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch {
                ops: vec![DatabaseOp::Table {
                    table: table_id,
                    change: TableChange::ReorderColumns {
                        order: vec![ids[2], ids[1], ids[0]],
                    },
                }],
                base_versions: HashMap::from([(table_id, seeded_version)]),
            },
        )
        .await
        .unwrap();
    let reordered_version = TableVersion(seeded_version.0 + 1);
    assert_eq!(
        reordered,
        vec![OpResult::Table {
            table: table_id,
            table_version: Some(reordered_version),
            change: TableResult::ColumnsReordered,
        }]
    );
    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        detail.tables[0]
            .columns
            .iter()
            .map(|column| column.column.id)
            .collect::<Vec<_>>(),
        vec![ids[2], ids[1], ids[0]]
    );

    let deleted = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: table_id,
                    column: ids[0],
                    change: ColumnChange::Delete,
                }],
                base_versions: HashMap::from([(table_id, reordered_version)]),
            },
        )
        .await
        .unwrap();
    let deleted_version = TableVersion(reordered_version.0 + 1);
    assert_eq!(
        deleted,
        vec![OpResult::Column {
            table: table_id,
            column: ids[0],
            table_version: deleted_version,
            change: ColumnResult::Deleted,
        }]
    );
    {
        let w = world.lock().unwrap();
        assert!(!w.columns.iter().any(|c| c.id == ids[0]));
        assert_eq!(w.definitions.len(), 3);
        assert_eq!(w.published.last(), Some(&(table_id, deleted_version)));
    }
    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        detail.tables[0]
            .columns
            .iter()
            .map(|column| column.column.id)
            .collect::<Vec<_>>(),
        vec![ids[2], ids[1]]
    );
}

#[tokio::test]
async fn schema_mutations_reject_wrong_database_stale_and_trashed_database() {
    let seeded = seeded().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let ids = vec![
        seeded.name_column.id,
        seeded.status_column.id,
        seeded.plus_ones_column.id,
    ];
    let seeded_version = table_version(&world, table_id);
    let ops = [
        DatabaseOp::Column {
            table: table_id,
            column: seeded.name_column.id,
            change: ColumnChange::ChangeType {
                to: ColumnKind::Text,
            },
        },
        DatabaseOp::Column {
            table: table_id,
            column: seeded.name_column.id,
            change: ColumnChange::Delete,
        },
        DatabaseOp::Table {
            table: table_id,
            change: TableChange::ReorderColumns { order: ids },
        },
    ];
    let at = |op: &DatabaseOp, version: TableVersion| OpBatch {
        ops: vec![op.clone()],
        base_versions: HashMap::from([(table_id, version)]),
    };

    let elsewhere = DatabaseId::new();
    for op in &ops {
        let result = svc
            .apply_ops(edit(elsewhere), viewer(OWNER), at(op, seeded_version))
            .await;
        assert!(matches!(result, Err(DatabaseError::NotFound)), "{result:?}");
    }

    for op in &ops {
        let result = svc
            .apply_ops(edit(db), viewer(OWNER), at(op, TableVersion(0)))
            .await;
        assert!(
            matches!(result, Err(DatabaseError::VersionConflict)),
            "{result:?}"
        );
    }

    world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    for op in &ops {
        let result = svc
            .apply_ops(edit(db), viewer(OWNER), at(op, seeded_version))
            .await;
        assert!(matches!(result, Err(DatabaseError::NotFound)), "{result:?}");
    }

    let w = world.lock().unwrap();
    assert_eq!(w.tables[0].version, seeded_version);
    assert_eq!(w.columns.len(), 3);
    assert_eq!(w.definitions.len(), 3);
}
