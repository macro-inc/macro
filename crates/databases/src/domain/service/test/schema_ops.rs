//! Schema ops batched with each other and with row ops: one transaction,
//! client-minted ids, base versions, and the rule a type change keeps.

use super::*;

#[tokio::test]
async fn one_batch_creates_a_table_a_select_column_and_rows_filling_it_by_option_id() {
    let seeded = seeded().await;
    let (sessions, track) = (TableId::new(), ColumnId::new());
    let (design, engineering) = (OptionId::new(), OptionId::new());

    let results = seeded
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
                    table: sessions,
                    column: track,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Track".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![
                                NewOption {
                                    id: design,
                                    label: "Design".into(),
                                },
                                NewOption {
                                    id: engineering,
                                    label: "Engineering".into(),
                                },
                            ],
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
                                column: track,
                                value: CellValue::Options(vec![OptionRef::Id(engineering)]),
                            }],
                            vec![CellWrite {
                                column: track,
                                value: CellValue::Options(vec![OptionRef::Id(design)]),
                            }],
                        ],
                    },
                },
            ]),
        )
        .await
        .unwrap();

    let rows = row_ids(&seeded.world, sessions);
    assert_eq!(
        results,
        vec![
            OpResult::Table {
                table: sessions,
                table_version: Some(TableVersion(1)),
                change: TableResult::Created,
            },
            OpResult::Column {
                table: sessions,
                column: track,
                table_version: TableVersion(1),
                change: ColumnResult::Created,
            },
            OpResult::Rows {
                table: sessions,
                table_version: TableVersion(1),
                change: RowsResult::Inserted { rows: rows.clone() },
            },
        ]
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 1);
    let definition = w
        .columns
        .iter()
        .find(|column| column.id == track && column.table_id == sessions)
        .unwrap()
        .property_definition_id;
    assert_eq!(
        w.definitions[&definition]
            .property_options
            .iter()
            .map(|option| (OptionId::from_uuid(option.id), option.value.clone()))
            .collect::<Vec<_>>(),
        vec![
            (design, PropertyOptionValue::String("Design".into())),
            (
                engineering,
                PropertyOptionValue::String("Engineering".into())
            ),
        ]
    );
    assert_eq!(
        w.cells[&rows[0]][&definition],
        PropertyValue::SelectOption(vec![engineering.into_uuid()])
    );
    assert_eq!(
        w.cells[&rows[1]][&definition],
        PropertyValue::SelectOption(vec![design.into_uuid()])
    );
}

#[tokio::test]
async fn a_refused_later_op_leaves_the_tables_and_columns_before_it_unwritten() {
    let seeded = seeded().await;
    let (sessions, track) = (TableId::new(), ColumnId::new());
    let definitions_before = seeded.world.lock().unwrap().definitions.len();
    let published_before = seeded.world.lock().unwrap().published.len();

    let error = seeded
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
                    table: sessions,
                    column: track,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Track".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![NewOption {
                                id: OptionId::new(),
                                label: "Design".into(),
                            }],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Rows {
                    table: sessions,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: track,
                            value: CellValue::Options(vec![OptionRef::Label("Marketing".into())]),
                        }]],
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
            op: 2,
            row: Some(0),
            column: Some(track),
            taken: None,
            reason: "`Marketing` is not an option of \"Track\"".into(),
        }
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 0);
    assert!(!w.tables.iter().any(|table| table.id == sessions));
    assert!(!w.columns.iter().any(|column| column.id == track));
    assert_eq!(w.definitions.len(), definitions_before);
    assert!(!w.rows.contains_key(&sessions));
    assert_eq!(w.published.len(), published_before);
}

#[tokio::test]
async fn a_new_column_under_an_existing_columns_id_is_refused_as_taken() {
    let seeded = seeded().await;
    let taken = seeded.name_column.id;

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: taken,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Notes".into(),
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
        refusal,
        OpRefusal {
            op: 0,
            row: None,
            column: Some(taken),
            taken: Some(TakenId::Column(taken)),
            reason: format!(
                "{taken} already names a column; mint a new id for each column a request creates"
            ),
        }
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 0);
    assert_eq!(
        w.columns
            .iter()
            .filter(|column| column.table_id == seeded.table_id)
            .count(),
        3
    );
}

#[tokio::test]
async fn an_option_id_minted_twice_in_one_batch_is_refused_as_taken() {
    let seeded = seeded().await;
    let minted = OptionId::new();
    let diet = ColumnId::new();

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: diet,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Diet".into(),
                            kind: ColumnKind::Select { multi: true },
                            options: vec![NewOption {
                                id: minted,
                                label: "Vegan".into(),
                            }],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: seeded.status_column.id,
                    change: ColumnChange::AddOptions {
                        options: vec![NewOption {
                            id: minted,
                            label: "Maybe".into(),
                        }],
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
            row: None,
            column: None,
            taken: Some(TakenId::Option(minted)),
            reason: format!(
                "{minted} already names an option; mint a new id for each option a request creates"
            ),
        }
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 0);
    assert!(!w.columns.iter().any(|column| column.id == diet));
    assert_eq!(
        w.definitions[&seeded.status_column.property_definition_id]
            .property_options
            .len(),
        2
    );
}

#[tokio::test]
async fn a_stale_base_version_is_a_conflict_and_writes_nothing() {
    let seeded = seeded().await;
    let current = table_version(&seeded.world, seeded.table_id);
    let published_before = seeded.world.lock().unwrap().published.len();
    let notes = ColumnId::new();

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch {
                ops: vec![
                    DatabaseOp::Column {
                        table: seeded.table_id,
                        column: notes,
                        change: ColumnChange::Create {
                            definition: NewColumn::New {
                                name: "Notes".into(),
                                kind: ColumnKind::Text,
                                options: vec![],
                                infer_type: false,
                            },
                            after: None,
                        },
                    },
                    DatabaseOp::Rows {
                        table: seeded.table_id,
                        change: RowsChange::Insert {
                            rows: vec![vec![CellWrite {
                                column: notes,
                                value: CellValue::Text("Vegetarian".into()),
                            }]],
                        },
                    },
                ],
                base_versions: HashMap::from([(seeded.table_id, TableVersion(current.0 - 1))]),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, DatabaseError::VersionConflict), "{error:?}");
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.write_batches, 0);
    assert!(!w.columns.iter().any(|column| column.id == notes));
    assert_eq!(w.rows[&seeded.table_id].len(), 1);
    assert_eq!(w.tables[0].version, current);
    assert_eq!(w.published.len(), published_before);
}

#[tokio::test]
async fn a_type_change_after_a_row_update_of_its_table_is_refused() {
    let seeded = seeded().await;

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::Uniform {
                            rows: vec![seeded.row_id],
                            cells: vec![CellWrite {
                                column: seeded.plus_ones_column.id,
                                value: CellValue::Number(3.0),
                            }],
                        },
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: seeded.name_column.id,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Select { multi: false },
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
            row: None,
            column: Some(seeded.name_column.id),
            taken: None,
            reason: SchemaError::RetypeAfterWrites.to_string(),
        }
    );
    assert_eq!(seeded.world.lock().unwrap().write_batches, 0);
    assert_eq!(
        cell(
            &seeded.world,
            seeded.row_id,
            seeded.plus_ones_column.property_definition_id
        ),
        Some(PropertyValue::Num(2.0))
    );
}

#[tokio::test]
async fn options_added_after_a_type_change_of_their_column_land_with_it() {
    let seeded = seeded().await;
    let before = table_version(&seeded.world, seeded.table_id);
    let vip = OptionId::new();

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: seeded.name_column.id,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Select { multi: false },
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: seeded.name_column.id,
                    change: ColumnChange::AddOptions {
                        options: vec![NewOption {
                            id: vip,
                            label: "VIP".into(),
                        }],
                    },
                },
            ]),
        )
        .await
        .unwrap();

    let after = TableVersion(before.0 + 1);
    assert_eq!(
        results,
        vec![
            OpResult::Column {
                table: seeded.table_id,
                column: seeded.name_column.id,
                table_version: after,
                change: ColumnResult::TypeChanged,
            },
            OpResult::Column {
                table: seeded.table_id,
                column: seeded.name_column.id,
                table_version: after,
                change: ColumnResult::OptionsAdded { added: vec![vip] },
            },
        ]
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
    assert_ne!(definition, seeded.name_column.property_definition_id);
    let w = seeded.world.lock().unwrap();
    let stored = &w.definitions[&definition];
    assert_eq!(stored.definition.data_type, DataType::SelectString);
    assert_eq!(
        catalog::option_labels(stored)
            .into_iter()
            .map(|(_, label)| label)
            .collect::<Vec<_>>(),
        vec!["Sam", "VIP"]
    );
    assert_eq!(stored.property_options[1].id, vip.into_uuid());
    assert_eq!(
        w.cells[&seeded.row_id][&definition],
        PropertyValue::SelectOption(vec![stored.property_options[0].id])
    );
}
