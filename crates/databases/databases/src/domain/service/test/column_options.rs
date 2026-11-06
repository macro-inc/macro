//! A select column's options are explicit schema: added, parsed and
//! validated before any cell may hold them.

use super::*;

#[tokio::test]
async fn a_select_column_with_no_options_accepts_nothing() {
    let seeded = seeded().await;
    let (svc, database_id, table_id) = (seeded.service, seeded.database_id, seeded.table_id);
    let stage = ColumnId::new();
    svc.apply_ops(
        edit(database_id),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: table_id,
            column: stage,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Stage".into(),
                    kind: ColumnKind::Select { multi: false },
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }]),
    )
    .await
    .unwrap();

    let error = svc
        .apply_ops(
            edit(database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: stage,
                        value: CellValue::Options(vec![OptionRef::Label("Main".into())]),
                    }]],
                },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(refusal.reason, "`Main` is not an option of \"Stage\"");
}

/// The point of the operation: the write that failed succeeds once the option
/// exists, and the table's version moves because its schema did.
#[tokio::test]
async fn add_options_extends_what_ops_accept_and_bumps_the_version() {
    let seeded = seeded().await;
    let (world, svc, db, guests, status) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.status_column,
    );
    let published_before = world.lock().unwrap().published.len();
    let before = table_version(&world, guests);
    let waitlisted = OptionId::new();

    let results = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: guests,
                column: status.id,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: waitlisted,
                        label: "Waitlisted".into(),
                    }],
                },
            }]),
        )
        .await
        .expect("edit access may extend a select column");
    assert_eq!(
        results,
        vec![OpResult::Column {
            table: guests,
            column: status.id,
            table_version: TableVersion(before.0 + 1),
            change: ColumnResult::OptionsAdded {
                added: vec![waitlisted],
            },
        }]
    );

    {
        let w = world.lock().unwrap();
        assert_eq!(
            catalog::option_labels(&w.definitions[&status.property_definition_id])
                .into_iter()
                .map(|(_, label)| label)
                .collect::<Vec<_>>(),
            vec!["Going", "Declined", "Waitlisted"],
            "new options are appended, so existing labels do not move"
        );
        assert_eq!(w.tables[0].version, TableVersion(before.0 + 1));
        assert_eq!(
            w.published.len(),
            published_before + 1,
            "the schema change is announced for liveness"
        );
    }

    let inserted = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: guests,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: status.id,
                        value: CellValue::Options(vec![OptionRef::Label("Waitlisted".into())]),
                    }]],
                },
            }]),
        )
        .await
        .expect("the option now resolves");
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };
    assert_eq!(
        cell(&world, inserted[0], status.property_definition_id),
        Some(PropertyValue::SelectOption(vec![waitlisted.into_uuid()]))
    );
}

/// Re-sending a label the column already has changes nothing: no duplicate
/// option, no version bump, no event — and no error either.
#[tokio::test]
async fn adding_an_existing_option_is_a_no_op() {
    let seeded = seeded().await;
    let (world, svc, db, guests, status) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.status_column,
    );
    let published_before = world.lock().unwrap().published.len();
    let before = table_version(&world, guests);

    let results = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: guests,
                column: status.id,
                change: ColumnChange::AddOptions {
                    options: vec![
                        NewOption {
                            id: OptionId::new(),
                            label: "going".into(),
                        },
                        NewOption {
                            id: OptionId::new(),
                            label: "  Declined  ".into(),
                        },
                    ],
                },
            }]),
        )
        .await
        .expect("an option that is already there is not an error");

    assert_eq!(
        results,
        vec![OpResult::Column {
            table: guests,
            column: status.id,
            table_version: before,
            change: ColumnResult::OptionsAdded { added: vec![] },
        }]
    );
    let w = world.lock().unwrap();
    assert_eq!(
        w.definitions[&status.property_definition_id]
            .property_options
            .len(),
        2
    );
    assert_eq!(w.tables[0].version, before);
    assert_eq!(w.published.len(), published_before);
}

#[tokio::test]
async fn options_are_refused_on_a_column_that_cannot_hold_them() {
    let seeded = seeded().await;
    let (svc, db, guests, name_column) = (
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.name_column.id,
    );

    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: guests,
                column: ColumnId::new(),
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Notes".into(),
                        kind: ColumnKind::Text,
                        options: vec![NewOption {
                            id: OptionId::new(),
                            label: "Main".into(),
                        }],
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
        SchemaError::OptionsOnPlainColumn.to_string()
    );

    // …and the same when adding options to the text column the seeded table
    // already has.
    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: guests,
                column: name_column,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: OptionId::new(),
                        label: "Main".into(),
                    }],
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
        "\"Name\" is a text column; only select and tag columns have options"
    );
}

/// A numeric select stores numbers, so its labels have to be numbers, and
/// labels naming the same number are one option.
#[tokio::test]
async fn numeric_select_options_are_parsed_as_numbers() {
    let seeded = seeded().await;
    let (world, svc, db, guests) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let priority_column = |options: &[&str]| {
        OpBatch::from(vec![DatabaseOp::Column {
            table: guests,
            column: ColumnId::new(),
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Priority".into(),
                    kind: ColumnKind::SelectNumber { multi: false },
                    options: options
                        .iter()
                        .map(|label| NewOption {
                            id: OptionId::new(),
                            label: (*label).into(),
                        })
                        .collect(),
                    infer_type: false,
                },
                after: None,
            },
        }])
    };

    let error = svc
        .apply_ops(edit(db), viewer(OWNER), priority_column(&["soon"]))
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::OptionNotNumber {
            label: "soon".into()
        }
        .to_string()
    );

    let error = svc
        .apply_ops(edit(db), viewer(OWNER), priority_column(&["1", "2.0", "2"]))
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::OptionListedTwice { label: "2".into() }.to_string()
    );

    let batch = priority_column(&["1", "2.0"]);
    let DatabaseOp::Column {
        column: priority, ..
    } = batch.ops[0]
    else {
        unreachable!("the batch creates a column");
    };
    svc.apply_ops(edit(db), viewer(OWNER), batch).await.unwrap();
    let w = world.lock().unwrap();
    let definition = w
        .columns
        .iter()
        .find(|column| column.id == priority)
        .unwrap()
        .property_definition_id;
    assert_eq!(
        w.definitions[&definition]
            .property_options
            .iter()
            .map(|option| option.value.clone())
            .collect::<Vec<_>>(),
        vec![
            PropertyOptionValue::Number(1.0),
            PropertyOptionValue::Number(2.0)
        ]
    );
}

#[tokio::test]
async fn option_labels_are_validated() {
    let seeded = seeded().await;
    let (svc, db, guests) = (seeded.service, seeded.database_id, seeded.table_id);
    let stage_column = |label: String| {
        OpBatch::from(vec![DatabaseOp::Column {
            table: guests,
            column: ColumnId::new(),
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Stage".into(),
                    kind: ColumnKind::Select { multi: false },
                    options: vec![NewOption {
                        id: OptionId::new(),
                        label,
                    }],
                    infer_type: false,
                },
                after: None,
            },
        }])
    };

    for (bad, reason) in [
        ("   ".to_string(), SchemaError::EmptyOptionLabel),
        (String::new(), SchemaError::EmptyOptionLabel),
        (
            "x".repeat(MAX_OPTION_LABEL_LEN + 1),
            SchemaError::OptionLabelTooLong {
                max: MAX_OPTION_LABEL_LEN,
            },
        ),
    ] {
        let error = svc
            .apply_ops(edit(db), viewer(OWNER), stage_column(bad.clone()))
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = error else {
            panic!("{bad:?}: expected a refused op, got {error:?}");
        };
        assert_eq!(refusal.reason, reason.to_string(), "{bad:?}");
    }
}

#[tokio::test]
async fn add_options_respects_receipts() {
    let seeded = seeded().await;
    let (world, svc, db, guests, status) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.status_column.id,
    );
    let waitlisted = |column: ColumnId| {
        OpBatch::from(vec![DatabaseOp::Column {
            table: guests,
            column,
            change: ColumnChange::AddOptions {
                options: vec![NewOption {
                    id: OptionId::new(),
                    label: "Waitlisted".into(),
                }],
            },
        }])
    };

    let error = svc
        .apply_ops(edit(DatabaseId::new()), viewer(OWNER), waitlisted(status))
        .await
        .unwrap_err();
    assert!(
        matches!(error, DatabaseError::NotFound),
        "a receipt for another database reaches nothing: {error:?}"
    );

    let missing = ColumnId::new();
    let error = svc
        .apply_ops(edit(db), viewer(OWNER), waitlisted(missing))
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
            column: Some(missing),
            taken: None,
            reason: "no such column in this table".into(),
        }
    );

    // Nothing was written on the way to either refusal.
    let w = world.lock().unwrap();
    assert_eq!(w.definitions.len(), 3);
    assert_eq!(w.write_batches, 0);
}
