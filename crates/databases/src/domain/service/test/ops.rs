//! Typed ops over the fakes: what each op writes, what refuses a batch, and
//! that a refused batch writes nothing.

use models_databases::{ColumnKind, RowChange};
use models_properties::shared::EntityReference;

use super::*;

#[tokio::test]
async fn an_insert_of_two_rows_mints_them_in_order_with_their_cells() {
    let seeded = seeded().await;
    let going = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Going",
    );
    let before = table_version(&seeded.world, seeded.table_id);

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![
                            CellWrite {
                                column: seeded.name_column.id,
                                value: CellValue::Text("Alex".into()),
                            },
                            CellWrite {
                                column: seeded.status_column.id,
                                value: CellValue::Options(vec![OptionRef::Id(going)]),
                            },
                        ],
                        vec![
                            CellWrite {
                                column: seeded.name_column.id,
                                value: CellValue::Text("Robin".into()),
                            },
                            CellWrite {
                                column: seeded.plus_ones_column.id,
                                value: CellValue::Number(3.0),
                            },
                        ],
                    ],
                },
            }]),
        )
        .await
        .unwrap();

    let rows = row_ids(&seeded.world, seeded.table_id);
    assert_eq!(rows.len(), 3);
    assert_eq!(
        results,
        vec![OpResult::Rows {
            table: seeded.table_id,
            table_version: TableVersion(before.0 + 1),
            change: RowsResult::Inserted {
                rows: vec![rows[1], rows[2]],
            },
        }]
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[1],
            seeded.name_column.property_definition_id
        ),
        Some(PropertyValue::Str("Alex".into()))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[1],
            seeded.status_column.property_definition_id
        ),
        Some(PropertyValue::SelectOption(vec![going.into_uuid()]))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[2],
            seeded.name_column.property_definition_id
        ),
        Some(PropertyValue::Str("Robin".into()))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[2],
            seeded.plus_ones_column.property_definition_id
        ),
        Some(PropertyValue::Num(3.0))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[2],
            seeded.status_column.property_definition_id
        ),
        None
    );
}

#[tokio::test]
async fn a_uniform_update_gives_three_rows_the_same_cells() {
    let seeded = seeded().await;
    insert_names(&seeded, &["Alex", "Robin"]).await;
    let rows = row_ids(&seeded.world, seeded.table_id);
    let declined = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Declined",
    );
    let before = table_version(&seeded.world, seeded.table_id);

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: rows.clone(),
                        cells: vec![
                            CellWrite {
                                column: seeded.status_column.id,
                                value: CellValue::Options(vec![OptionRef::Label(
                                    "declined".into(),
                                )]),
                            },
                            CellWrite {
                                column: seeded.plus_ones_column.id,
                                value: CellValue::Clear,
                            },
                        ],
                    },
                },
            }]),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Rows {
            table: seeded.table_id,
            table_version: TableVersion(before.0 + 1),
            change: RowsResult::Updated { affected: 3 },
        }]
    );
    for row in &rows {
        assert_eq!(
            cell(
                &seeded.world,
                *row,
                seeded.status_column.property_definition_id
            ),
            Some(PropertyValue::SelectOption(vec![declined.into_uuid()]))
        );
        assert_eq!(
            cell(
                &seeded.world,
                *row,
                seeded.plus_ones_column.property_definition_id
            ),
            None
        );
    }
    assert_eq!(
        cell(
            &seeded.world,
            seeded.row_id,
            seeded.name_column.property_definition_id
        ),
        Some(PropertyValue::Str("Sam".into()))
    );
}

#[tokio::test]
async fn a_per_row_update_gives_each_row_its_own_cells() {
    let seeded = seeded().await;
    insert_names(&seeded, &["Alex"]).await;
    let rows = row_ids(&seeded.world, seeded.table_id);

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![
                            RowChange {
                                row: rows[0],
                                cells: vec![CellWrite {
                                    column: seeded.name_column.id,
                                    value: CellValue::Text("Samantha".into()),
                                }],
                            },
                            RowChange {
                                row: rows[1],
                                cells: vec![CellWrite {
                                    column: seeded.plus_ones_column.id,
                                    value: CellValue::Number(1.0),
                                }],
                            },
                        ],
                    },
                },
            }]),
        )
        .await
        .unwrap();

    assert!(matches!(
        results.as_slice(),
        [OpResult::Rows {
            change: RowsResult::Updated { affected: 2 },
            ..
        }]
    ));
    assert_eq!(
        cell(
            &seeded.world,
            rows[0],
            seeded.name_column.property_definition_id
        ),
        Some(PropertyValue::Str("Samantha".into()))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[0],
            seeded.plus_ones_column.property_definition_id
        ),
        Some(PropertyValue::Num(2.0))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[1],
            seeded.name_column.property_definition_id
        ),
        Some(PropertyValue::Str("Alex".into()))
    );
    assert_eq!(
        cell(
            &seeded.world,
            rows[1],
            seeded.plus_ones_column.property_definition_id
        ),
        Some(PropertyValue::Num(1.0))
    );
}

#[tokio::test]
async fn a_delete_removes_the_rows_and_their_cells() {
    let seeded = seeded().await;
    let before = table_version(&seeded.world, seeded.table_id);

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Delete {
                    rows: vec![seeded.row_id],
                },
            }]),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Rows {
            table: seeded.table_id,
            table_version: TableVersion(before.0 + 1),
            change: RowsResult::Deleted { affected: 1 },
        }]
    );
    assert!(row_ids(&seeded.world, seeded.table_id).is_empty());
    assert!(
        !seeded
            .world
            .lock()
            .unwrap()
            .cells
            .contains_key(&seeded.row_id)
    );
}

#[tokio::test]
async fn an_unknown_label_is_refused_without_creating_options() {
    let seeded = seeded().await;
    let before = table_version(&seeded.world, seeded.table_id);

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: seeded.status_column.id,
                        value: CellValue::Options(vec![OptionRef::Label("Maybe".into())]),
                    }]],
                },
            }]),
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
            column: Some(seeded.status_column.id),
            taken: None,
            reason: "`Maybe` is not an option of \"Status\"".into(),
        }
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(
        w.definitions[&seeded.status_column.property_definition_id]
            .property_options
            .len(),
        2
    );
    assert_eq!(w.rows[&seeded.table_id].len(), 1);
    assert_eq!(w.write_batches, 0);
    drop(w);
    assert_eq!(table_version(&seeded.world, seeded.table_id), before);
}

#[tokio::test]
async fn an_op_on_another_databases_table_refuses_the_batch_before_anything_is_written() {
    let seeded = seeded().await;
    let other = seeded
        .service
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: user(OWNER),
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    let other_table = seeded
        .world
        .lock()
        .unwrap()
        .tables
        .iter()
        .find(|table| table.database_id == other.id)
        .unwrap()
        .id;
    let published_before = seeded.world.lock().unwrap().published.len();

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Insert { rows: vec![vec![]] },
                },
                DatabaseOp::Rows {
                    table: other_table,
                    change: RowsChange::Insert { rows: vec![vec![]] },
                },
            ]),
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
            row: None,
            column: None,
            taken: None,
            reason: format!("table {other_table} is not in this database"),
        }
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 0);
    assert_eq!(w.rows[&seeded.table_id].len(), 1);
    assert!(w.rows.get(&other_table).is_none_or(Vec::is_empty));
    assert_eq!(w.published.len(), published_before);
}

#[tokio::test]
async fn a_failing_second_op_leaves_the_first_unapplied() {
    let seeded = seeded().await;
    let status = seeded.status_column.property_definition_id;
    let before = table_version(&seeded.world, seeded.table_id);
    let published_before = seeded.world.lock().unwrap().published.len();
    let ghost = Uuid::now_v7();

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: seeded.name_column.id,
                            value: CellValue::Text("Alex".into()),
                        }]],
                    },
                },
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow {
                            rows: vec![
                                RowChange {
                                    row: seeded.row_id,
                                    cells: vec![CellWrite {
                                        column: seeded.name_column.id,
                                        value: CellValue::Text("Samantha".into()),
                                    }],
                                },
                                RowChange {
                                    row: RowId::from_uuid(ghost),
                                    cells: vec![CellWrite {
                                        column: seeded.name_column.id,
                                        value: CellValue::Text("Nobody".into()),
                                    }],
                                },
                            ],
                        },
                    },
                },
            ]),
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
            row: Some(1),
            column: None,
            taken: None,
            reason: format!("no row {ghost} in this table"),
        }
    );
    assert_eq!(row_ids(&seeded.world, seeded.table_id), vec![seeded.row_id]);
    assert_eq!(
        cell(
            &seeded.world,
            seeded.row_id,
            seeded.name_column.property_definition_id
        ),
        Some(PropertyValue::Str("Sam".into()))
    );
    assert_eq!(
        seeded.world.lock().unwrap().definitions[&status]
            .property_options
            .len(),
        2
    );
    assert_eq!(table_version(&seeded.world, seeded.table_id), before);
    assert_eq!(
        seeded.world.lock().unwrap().published.len(),
        published_before
    );
}

#[tokio::test]
async fn a_value_that_does_not_fit_its_column_names_the_op_row_and_column() {
    let seeded = seeded().await;

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row: seeded.row_id,
                            cells: vec![CellWrite {
                                column: seeded.plus_ones_column.id,
                                value: CellValue::Text("two".into()),
                            }],
                        }],
                    },
                },
            }]),
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
            column: Some(seeded.plus_ones_column.id),
            taken: None,
            reason: "\"Plus ones\" is a number column; text does not fit it".into(),
        }
    );
}

#[tokio::test]
async fn a_relation_cell_names_rows_of_its_target_table() {
    let seeded = seeded().await;
    let (sessions, relation) = (TableId::new(), ColumnId::new());
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Table {
                    table: sessions,
                    change: TableChange::Create {
                        name: "Sessions".into(),
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: relation,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Sessions".into(),
                            kind: ColumnKind::Relation {
                                database: seeded.database_id,
                                table: sessions,
                            },
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
    let relation_definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == relation)
        .unwrap()
        .property_definition_id;
    let keynote = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: sessions,
                change: RowsChange::Insert { rows: vec![vec![]] },
            }]),
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

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![seeded.row_id],
                        cells: vec![CellWrite {
                            column: relation,
                            value: CellValue::Rows(vec![keynote]),
                        }],
                    },
                },
            }]),
        )
        .await
        .unwrap();
    assert_eq!(
        cell(&seeded.world, seeded.row_id, relation_definition),
        Some(PropertyValue::EntityRef(vec![EntityReference {
            entity_id: keynote.to_string(),
            entity_type: PropertyEntityType::DatabaseRow,
            specific_message_id: None,
        }]))
    );

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![seeded.row_id],
                        cells: vec![CellWrite {
                            column: relation,
                            value: CellValue::Rows(vec![seeded.row_id]),
                        }],
                    },
                },
            }]),
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
            column: Some(relation),
            taken: None,
            reason: format!("row {} is not a row of the related table", seeded.row_id),
        }
    );
    assert_eq!(
        cell(&seeded.world, seeded.row_id, relation_definition),
        Some(PropertyValue::EntityRef(vec![EntityReference {
            entity_id: keynote.to_string(),
            entity_type: PropertyEntityType::DatabaseRow,
            specific_message_id: None,
        }]))
    );
}

#[tokio::test]
async fn a_type_change_converts_the_columns_cells() {
    let seeded = seeded().await;
    let rows = insert_names(&seeded, &["12"]).await;
    seeded
        .world
        .lock()
        .unwrap()
        .cells
        .get_mut(&seeded.row_id)
        .unwrap()
        .remove(&seeded.name_column.property_definition_id);

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seeded.name_column.id,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Number,
                },
            }]),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::Column {
            table: seeded.table_id,
            column: seeded.name_column.id,
            table_version: table_version(&seeded.world, seeded.table_id),
            change: ColumnResult::TypeChanged,
        }]
    );
    let definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == seeded.name_column.id)
        .unwrap()
        .property_definition_id;
    assert_eq!(cell(&seeded.world, seeded.row_id, definition), None);
    assert_eq!(
        cell(&seeded.world, rows[0], definition),
        Some(PropertyValue::Num(12.0))
    );
}

#[tokio::test]
async fn a_batch_bumps_each_table_once_and_announces_it_once() {
    let seeded = seeded().await;
    let before = table_version(&seeded.world, seeded.table_id);
    let published_before = seeded.world.lock().unwrap().published.len();
    let events_before = seeded.world.lock().unwrap().broker_events.len();

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: seeded.name_column.id,
                            value: CellValue::Text("Alex".into()),
                        }]],
                    },
                },
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::Uniform {
                            rows: vec![seeded.row_id],
                            cells: vec![CellWrite {
                                column: seeded.plus_ones_column.id,
                                value: CellValue::Number(0.0),
                            }],
                        },
                    },
                },
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Delete {
                        rows: vec![seeded.row_id],
                    },
                },
            ]),
        )
        .await
        .unwrap();

    let after = TableVersion(before.0 + 1);
    assert_eq!(table_version(&seeded.world, seeded.table_id), after);
    assert!(results.iter().all(|result| matches!(
        result,
        OpResult::Rows { table_version, .. } if *table_version == after
    )));
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 1);
    assert_eq!(
        &w.published[published_before..],
        &[(seeded.table_id, after)]
    );
    let events = &w.broker_events[events_before..];
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["event_type"], "database.tables_changed");
    assert_eq!(events[0]["metadata"]["attribution"]["actor"], OWNER);
    assert_eq!(
        events[0]["metadata"]["tables"],
        serde_json::json!([{"table_id": seeded.table_id, "version": after.0}])
    );
}
