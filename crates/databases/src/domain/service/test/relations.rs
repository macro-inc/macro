//! Relation columns: a cell naming rows of the table the column points at.

use super::*;

/// The seeded database with a `Sessions(Title)` table holding `Keynote`,
/// and a relation column `Sessions` on `Guests` pointing at it.
struct Linked {
    seeded: Seeded,
    sessions_table: TableId,
    keynote_row: RowId,
    relation_column: Column,
}

async fn linked() -> Linked {
    let seeded = seeded().await;
    let (sessions, title, relation_column) = (TableId::new(), ColumnId::new(), ColumnId::new());
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
                    table: sessions,
                    column: title,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Title".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: relation_column,
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
    let keynote = seeded
        .service
        .apply_ops(
            receipt::<EditAccessLevel>(seeded.database_id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: sessions,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: title,
                        value: CellValue::Text("Keynote".into()),
                    }]],
                },
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
    let relation_column = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == relation_column)
        .unwrap()
        .clone();
    Linked {
        seeded,
        sessions_table: sessions,
        keynote_row: inserted[0],
        relation_column,
    }
}

#[tokio::test]
async fn a_relation_write_moves_only_the_table_holding_the_cell() {
    let Linked {
        seeded,
        sessions_table,
        keynote_row,
        relation_column,
    } = linked().await;
    let (world, svc, db, table_id, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
    );
    let sessions_version = table_version(&world, sessions_table);
    let before = table_version(&world, table_id);

    let written = svc
        .apply_ops(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![row_id],
                        cells: vec![CellWrite {
                            column: relation_column.id,
                            value: CellValue::Rows(vec![keynote_row]),
                        }],
                    },
                },
            }]),
        )
        .await
        .unwrap();

    assert_eq!(
        written,
        vec![OpResult::Rows {
            table: table_id,
            table_version: TableVersion(before.0 + 1),
            change: RowsResult::Updated { affected: 1 },
        }]
    );
    assert_eq!(table_version(&world, sessions_table), sessions_version);
    assert_eq!(
        cell(&world, row_id, relation_column.property_definition_id),
        Some(PropertyValue::EntityRef(vec![
            models_properties::EntityReference {
                entity_id: keynote_row.to_string(),
                entity_type: PropertyEntityType::DatabaseRow,
                specific_message_id: None,
            }
        ]))
    );
}

#[tokio::test]
async fn changing_a_linked_columns_type_requires_clearing_its_relations_first() {
    let Linked {
        seeded,
        keynote_row,
        relation_column,
        ..
    } = linked().await;
    let (world, svc, db, table_id, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
    );
    svc.apply_ops(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Rows {
            table: table_id,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![row_id],
                    cells: vec![CellWrite {
                        column: relation_column.id,
                        value: CellValue::Rows(vec![keynote_row]),
                    }],
                },
            },
        }]),
    )
    .await
    .unwrap();

    let before = table_version(&world, table_id);

    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: table_id,
                    column: relation_column.id,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Text,
                    },
                }],
                base_versions: HashMap::from([(table_id, before)]),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::InvalidOp(_)), "{error:?}");
    let w = world.lock().unwrap();
    assert_eq!(w.tables[0].version, before);
    assert_eq!(
        w.columns
            .iter()
            .find(|column| column.id == relation_column.id)
            .unwrap()
            .property_definition_id,
        relation_column.property_definition_id
    );
}
