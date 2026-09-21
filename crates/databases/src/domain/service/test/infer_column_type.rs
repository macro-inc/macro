use super::*;

async fn empty_column() -> (Shared, Service, DatabaseId, InferColumnType) {
    let (world, svc, db, table_id) = seeded().await;
    let column_id = svc
        .create_column(
            receipt(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            CreateColumn {
                table_id,
                infer_type: true,
                config: None,
                binding: ColumnBinding::NewDefinition {
                    name: "Estimate".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
                    options: Vec::new(),
                },
            },
        )
        .await
        .unwrap();
    let base_version = world.lock().unwrap().tables[0].version;
    (
        world,
        svc,
        db,
        InferColumnType {
            table_id,
            column_id,
            data_type: DataType::Number,
            specific_entity_type: None,
            base_version,
        },
    )
}

#[tokio::test]
async fn number_inference_preserves_label_sql_old_definition_and_accepts_first_write() {
    let (world, svc, db, cmd) = empty_column().await;
    let old_definition = {
        let mut w = world.lock().unwrap();
        let column = w
            .columns
            .iter_mut()
            .find(|c| c.id == cmd.column_id)
            .unwrap();
        column.display_name = Some("Hours".into());
        column.property_definition_id
    };
    let response = svc
        .infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            cmd.clone(),
        )
        .await
        .unwrap();
    assert_eq!(response.column.column.id, cmd.column_id);
    assert_eq!(response.column.sql_name, "estimate");
    assert_eq!(
        response.column.column.display_name.as_deref(),
        Some("Hours")
    );
    assert!(!response.column.column.infer_type);
    assert_eq!(
        response.column.definition.definition.data_type,
        DataType::Number
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
    assert_eq!(response.table_version, TableVersion(cmd.base_version.0 + 1));
    let outcome = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "INSERT INTO guests (estimate) VALUES (12)".into(),
                base_versions: Some(HashMap::from([(cmd.table_id, response.table_version)])),
            },
        )
        .await
        .unwrap();
    assert_eq!(outcome.inserted_row_ids.len(), 1);
    let detail = svc
        .get_database(receipt(db, OWNER, AccessLevel::View), viewer(OWNER))
        .await
        .unwrap();
    let inferred = detail.tables[0]
        .columns
        .iter()
        .find(|c| c.column.id == cmd.column_id)
        .unwrap();
    assert_eq!(inferred.sql_name, "estimate");
    assert_eq!(inferred.definition.definition.data_type, DataType::Number);
}

#[tokio::test]
async fn entity_inference_persists_specific_type_and_text_only_settles_flag() {
    for (data_type, entity_type) in [
        (DataType::Entity, Some(PropertyEntityType::User)),
        (DataType::Entity, Some(PropertyEntityType::Document)),
        (DataType::String, None),
    ] {
        let (world, svc, db, mut cmd) = empty_column().await;
        cmd.data_type = data_type;
        cmd.specific_entity_type = entity_type;
        let old = world
            .lock()
            .unwrap()
            .columns
            .iter()
            .find(|c| c.id == cmd.column_id)
            .unwrap()
            .property_definition_id;
        let response = svc
            .infer_column_type(receipt(db, OWNER, AccessLevel::Edit), viewer(OWNER), cmd)
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
    }
}

#[tokio::test]
async fn inference_refuses_nonempty_column_and_removes_unused_replacement() {
    let (world, svc, db, cmd) = empty_column().await;
    let count = {
        let mut w = world.lock().unwrap();
        let id = w
            .columns
            .iter()
            .find(|c| c.id == cmd.column_id)
            .unwrap()
            .property_definition_id;
        w.rows.get_mut(&cmd.table_id).unwrap()[0].cells.insert(
            id,
            models_properties::service::property_value::PropertyValue::Str("existing".into()),
        );
        w.definitions.len()
    };
    assert!(matches!(
        svc.infer_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            cmd.clone()
        )
        .await,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
    let w = world.lock().unwrap();
    assert_eq!(w.definitions.len(), count);
    assert_eq!(w.tables[0].version, cmd.base_version);
    assert!(
        w.columns
            .iter()
            .find(|c| c.id == cmd.column_id)
            .unwrap()
            .infer_type
    );
}

#[tokio::test]
async fn inference_rejects_stale_wrong_database_trashed_and_fixed_columns() {
    for scenario in ["stale", "wrong_database", "trashed", "explicit", "shared"] {
        let (world, svc, db, mut cmd) = empty_column().await;
        let mut receipt_db = db;
        {
            let mut w = world.lock().unwrap();
            match scenario {
                "stale" => cmd.base_version.0 -= 1,
                "wrong_database" => receipt_db = Uuid::new_v4(),
                "trashed" => w.databases[0].trashed_at = Some(Utc::now()),
                "explicit" => {
                    w.columns
                        .iter_mut()
                        .find(|c| c.id == cmd.column_id)
                        .unwrap()
                        .infer_type = false
                }
                "shared" => {
                    let id = w
                        .columns
                        .iter()
                        .find(|c| c.id == cmd.column_id)
                        .unwrap()
                        .property_definition_id;
                    w.definitions.get_mut(&id).unwrap().definition.owner = PropertyOwner::User {
                        user_id: OWNER.into(),
                    };
                }
                _ => unreachable!(),
            }
        }
        let before = world.lock().unwrap().definitions.len();
        let error = svc
            .infer_column_type(
                receipt(receipt_db, OWNER, AccessLevel::Edit),
                viewer(OWNER),
                cmd,
            )
            .await
            .unwrap_err();
        assert!(
            matches!(
                error,
                DatabaseError::NotFound
                    | DatabaseError::VersionConflict
                    | DatabaseError::InvalidSchemaOperation(_)
            ),
            "{scenario}: {error}"
        );
        assert_eq!(world.lock().unwrap().definitions.len(), before);
    }
}

#[tokio::test]
async fn inference_validates_type_and_entity_configuration_before_creating_definitions() {
    for (data_type, specific_entity_type) in [
        (DataType::Boolean, None),
        (DataType::Entity, None),
        (DataType::Number, Some(PropertyEntityType::User)),
    ] {
        let (world, svc, db, mut cmd) = empty_column().await;
        cmd.data_type = data_type;
        cmd.specific_entity_type = specific_entity_type;
        let before = world.lock().unwrap().definitions.len();
        assert!(matches!(
            svc.infer_column_type(receipt(db, OWNER, AccessLevel::Edit), viewer(OWNER), cmd)
                .await,
            Err(DatabaseError::InvalidSchemaOperation(_))
        ));
        assert_eq!(world.lock().unwrap().definitions.len(), before);
    }
}

#[tokio::test]
async fn inference_flag_is_rejected_for_shared_or_explicitly_typed_creation() {
    for shared in [false, true] {
        let (world, svc, db, cmd) = empty_column().await;
        let id = world.lock().unwrap().columns[0].property_definition_id;
        let binding = if shared {
            ColumnBinding::ExistingDefinition(id)
        } else {
            ColumnBinding::NewDefinition {
                name: "Number".into(),
                data_type: DataType::Number,
                is_multi_select: false,
                options: Vec::new(),
            }
        };
        assert!(matches!(
            svc.create_column(
                receipt(db, OWNER, AccessLevel::Edit),
                viewer(OWNER),
                CreateColumn {
                    table_id: cmd.table_id,
                    infer_type: true,
                    binding,
                    config: None
                }
            )
            .await,
            Err(DatabaseError::InvalidSchemaOperation(_))
        ));
    }
}

#[tokio::test]
async fn sql_first_value_settles_text_type_and_later_inference_cannot_retype() {
    let (world, svc, db, mut cmd) = empty_column().await;
    let response = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "INSERT INTO guests (estimate) VALUES ('first text')".into(),
                base_versions: Some(HashMap::from([(cmd.table_id, cmd.base_version)])),
            },
        )
        .await
        .unwrap();
    assert_eq!(response.inserted_row_ids.len(), 1);
    {
        let w = world.lock().unwrap();
        let column = w.columns.iter().find(|c| c.id == cmd.column_id).unwrap();
        assert!(!column.infer_type);
        assert_eq!(
            w.definitions[&column.property_definition_id]
                .definition
                .data_type,
            DataType::String
        );
        cmd.base_version = w.tables[0].version;
    }
    assert!(matches!(
        svc.infer_column_type(receipt(db, OWNER, AccessLevel::Edit), viewer(OWNER), cmd)
            .await,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
}
