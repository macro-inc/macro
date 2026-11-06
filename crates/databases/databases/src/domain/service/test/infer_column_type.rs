use super::*;

/// The seeded table with an empty `Estimate` text column that may infer its
/// type from its first value.
struct EmptyColumn {
    seeded: Seeded,
    column_id: ColumnId,
}

async fn empty_column() -> EmptyColumn {
    let seeded = seeded().await;
    let column_id = ColumnId::new();
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: column_id,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Estimate".into(),
                        kind: ColumnKind::Text,
                        options: vec![],
                        infer_type: true,
                    },
                    after: None,
                },
            }]),
        )
        .await
        .unwrap();
    EmptyColumn { seeded, column_id }
}

#[tokio::test]
async fn number_inference_preserves_label_old_definition_and_accepts_first_write() {
    let EmptyColumn { seeded, column_id } = empty_column().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let old_definition = {
        let mut w = world.lock().unwrap();
        let column = w.columns.iter_mut().find(|c| c.id == column_id).unwrap();
        column.display_name = Some("Hours".into());
        column.property_definition_id
    };
    let response = svc
        .infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            InferColumnType {
                table_id,
                column_id,
                data_type: DataType::Number,
                specific_entity_type: None,
                base_version: TableVersion(3),
            },
        )
        .await
        .unwrap();
    assert_eq!(response.column.column.id, column_id);
    assert_eq!(response.column.sql_name, "\"Hours\"");
    assert_eq!(
        response.column.column.display_name.as_deref(),
        Some("Hours")
    );
    assert!(!response.column.column.infer_type);
    assert_eq!(
        response.column.definition.definition.data_type,
        DataType::Number
    );
    assert_eq!(
        response.column.definition.definition.display_name,
        "Estimate"
    );
    assert_ne!(
        response.column.column.property_definition_id,
        old_definition
    );
    assert_eq!(
        world.lock().unwrap().definitions[&old_definition]
            .definition
            .data_type,
        DataType::String
    );
    assert_eq!(response.table_version, TableVersion(4));
    assert_eq!(
        world.lock().unwrap().published.last(),
        Some(&(table_id, TableVersion(4)))
    );

    let written = svc
        .apply_ops(
            receipt(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: column_id,
                        value: CellValue::Number(12.0),
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
    ] = written.as_slice()
    else {
        panic!("expected one insert, got {written:?}");
    };
    assert_eq!(
        cell(
            &world,
            inserted[0],
            response.column.column.property_definition_id
        ),
        Some(PropertyValue::Num(12.0))
    );
    let detail = svc
        .get_database(receipt(db, OWNER, AccessLevel::View))
        .await
        .unwrap();
    let inferred = detail.tables[0]
        .columns
        .iter()
        .find(|c| c.column.id == column_id)
        .unwrap();
    assert_eq!(inferred.sql_name, "\"Hours\"");
    assert_eq!(inferred.definition.definition.data_type, DataType::Number);
}

#[tokio::test]
async fn entity_inference_persists_specific_type_and_text_only_settles_flag() {
    for (data_type, entity_type) in [
        (DataType::Entity, Some(PropertyEntityType::User)),
        (DataType::Entity, Some(PropertyEntityType::Document)),
        (DataType::String, None),
    ] {
        let EmptyColumn { seeded, column_id } = empty_column().await;
        let (world, svc, db, table_id) = (
            seeded.world,
            seeded.service,
            seeded.database_id,
            seeded.table_id,
        );
        let old = world
            .lock()
            .unwrap()
            .columns
            .iter()
            .find(|c| c.id == column_id)
            .unwrap()
            .property_definition_id;
        let response = svc
            .infer_column_type(
                receipt(db, OWNER, AccessLevel::Edit),
                InferColumnType {
                    table_id,
                    column_id,
                    data_type,
                    specific_entity_type: entity_type,
                    base_version: TableVersion(3),
                },
            )
            .await
            .unwrap();
        assert_eq!(response.column.definition.definition.data_type, data_type);
        assert_eq!(
            response.column.definition.definition.specific_entity_type,
            entity_type
        );
        assert_eq!(
            response.column.column.property_definition_id == old,
            data_type == DataType::String
        );
        assert!(!response.column.column.infer_type);
        assert_eq!(response.table_version, TableVersion(4));
        assert!(
            !world
                .lock()
                .unwrap()
                .columns
                .iter()
                .find(|c| c.id == column_id)
                .unwrap()
                .infer_type
        );
    }
}

#[tokio::test]
async fn inference_refuses_nonempty_column_and_removes_unused_replacement() {
    let EmptyColumn { seeded, column_id } = empty_column().await;
    let (world, svc, db, table_id, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
    );
    {
        let mut w = world.lock().unwrap();
        let definition = w
            .columns
            .iter()
            .find(|c| c.id == column_id)
            .unwrap()
            .property_definition_id;
        w.cells
            .get_mut(&row_id)
            .unwrap()
            .insert(definition, PropertyValue::Str("existing".into()));
    }
    assert!(matches!(
        svc.infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            InferColumnType {
                table_id,
                column_id,
                data_type: DataType::Number,
                specific_entity_type: None,
                base_version: TableVersion(3),
            }
        )
        .await,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
    let w = world.lock().unwrap();
    assert_eq!(w.definitions.len(), 4);
    assert_eq!(w.tables[0].version, TableVersion(3));
    assert!(
        w.columns
            .iter()
            .find(|c| c.id == column_id)
            .unwrap()
            .infer_type
    );
}

#[tokio::test]
async fn inference_rejects_stale_wrong_database_trashed_and_fixed_columns() {
    let EmptyColumn { seeded, column_id } = empty_column().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let command = |base_version: TableVersion| InferColumnType {
        table_id,
        column_id,
        data_type: DataType::Number,
        specific_entity_type: None,
        base_version,
    };

    let error = svc
        .infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            command(TableVersion(0)),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::VersionConflict), "{error}");

    let error = svc
        .infer_column_type(
            receipt(DatabaseId::new(), OWNER, AccessLevel::Edit),
            command(TableVersion(3)),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound), "{error}");

    // A column typed explicitly at creation never infers.
    world
        .lock()
        .unwrap()
        .columns
        .iter_mut()
        .find(|c| c.id == column_id)
        .unwrap()
        .infer_type = false;
    let error = svc
        .infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            command(TableVersion(3)),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, DatabaseError::InvalidSchemaOperation(_)),
        "{error}"
    );
    world
        .lock()
        .unwrap()
        .columns
        .iter_mut()
        .find(|c| c.id == column_id)
        .unwrap()
        .infer_type = true;

    // Neither does a column bound to a definition the database does not own.
    {
        let mut w = world.lock().unwrap();
        let definition = w
            .columns
            .iter()
            .find(|c| c.id == column_id)
            .unwrap()
            .property_definition_id;
        w.definitions.get_mut(&definition).unwrap().definition.owner = PropertyOwner::User {
            user_id: OWNER.into(),
        };
    }
    let error = svc
        .infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            command(TableVersion(3)),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, DatabaseError::InvalidSchemaOperation(_)),
        "{error}"
    );

    world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    let error = svc
        .infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            command(TableVersion(3)),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound), "{error}");

    let w = world.lock().unwrap();
    assert_eq!(w.definitions.len(), 4);
    assert_eq!(w.tables[0].version, TableVersion(3));
}

#[tokio::test]
async fn inference_validates_type_and_entity_configuration_before_creating_definitions() {
    for (data_type, specific_entity_type) in [
        (DataType::Boolean, None),
        (DataType::Entity, None),
        (DataType::Number, Some(PropertyEntityType::User)),
    ] {
        let EmptyColumn { seeded, column_id } = empty_column().await;
        let (world, svc, db, table_id) = (
            seeded.world,
            seeded.service,
            seeded.database_id,
            seeded.table_id,
        );
        assert!(matches!(
            svc.infer_column_type(
                receipt(db, OWNER, AccessLevel::Edit),
                InferColumnType {
                    table_id,
                    column_id,
                    data_type,
                    specific_entity_type,
                    base_version: TableVersion(3),
                }
            )
            .await,
            Err(DatabaseError::InvalidSchemaOperation(_))
        ));
        assert_eq!(world.lock().unwrap().definitions.len(), 4);
    }
}

#[tokio::test]
async fn inference_flag_is_rejected_for_an_explicitly_typed_creation() {
    let seeded = seeded().await;
    let (svc, db, table_id) = (seeded.service, seeded.database_id, seeded.table_id);
    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: table_id,
                column: ColumnId::new(),
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Number".into(),
                        kind: ColumnKind::Number,
                        options: vec![],
                        infer_type: true,
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
        SchemaError::InferenceNeedsPlainText.to_string()
    );
}

#[tokio::test]
async fn a_first_written_value_settles_text_type_and_later_inference_cannot_retype() {
    let EmptyColumn { seeded, column_id } = empty_column().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let definition = world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|c| c.id == column_id)
        .unwrap()
        .property_definition_id;
    svc.apply_ops(
        receipt(db, OWNER, AccessLevel::Edit),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Rows {
            table: table_id,
            change: RowsChange::Insert {
                rows: vec![vec![CellWrite {
                    column: column_id,
                    value: CellValue::Text("first text".into()),
                }]],
            },
        }]),
    )
    .await
    .unwrap();
    {
        let w = world.lock().unwrap();
        assert_eq!(w.settled.last(), Some(&(table_id, vec![definition])));
        let column = w.columns.iter().find(|c| c.id == column_id).unwrap();
        assert!(!column.infer_type);
        assert_eq!(column.property_definition_id, definition);
        assert_eq!(
            w.definitions[&definition].definition.data_type,
            DataType::String
        );
    }
    assert!(matches!(
        svc.infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            InferColumnType {
                table_id,
                column_id,
                data_type: DataType::Number,
                specific_entity_type: None,
                base_version: TableVersion(4),
            }
        )
        .await,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
}
