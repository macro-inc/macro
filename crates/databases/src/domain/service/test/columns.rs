use super::*;
use models_properties::service::property_value::PropertyValue;

fn command(world: &Shared, table_id: TableId, name: &str, data_type: DataType) -> ChangeColumnType {
    let w = world.lock().unwrap();
    let column = w
        .columns
        .iter()
        .find(|c| {
            c.table_id == table_id
                && w.definitions[&c.property_definition_id]
                    .definition
                    .display_name
                    == name
        })
        .unwrap();
    ChangeColumnType {
        table_id,
        column_id: column.id,
        data_type,
        is_multi_select: false,
        specific_entity_type: None,
        relation: None,
        base_version: w.tables.iter().find(|t| t.id == table_id).unwrap().version,
    }
}

#[tokio::test]
async fn number_text_conversion_preserves_values_labels_and_shared_definition() {
    let (world, svc, db, table_id) = seeded().await;
    let cmd = command(&world, table_id, "Plus ones", DataType::String);
    let old = world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|c| c.id == cmd.column_id)
        .unwrap()
        .property_definition_id;
    svc.change_column_type(
        receipt(db, OWNER, AccessLevel::Edit),
        viewer(OWNER),
        cmd.clone(),
    )
    .await
    .unwrap();
    let new_id = {
        let w = world.lock().unwrap();
        let column = w.columns.iter().find(|c| c.id == cmd.column_id).unwrap();
        assert_ne!(column.property_definition_id, old);
        assert_eq!(w.definitions[&old].definition.data_type, DataType::Number);
        assert_eq!(
            w.rows[&table_id][0].cells[&column.property_definition_id],
            PropertyValue::Str("2".into())
        );
        assert!(!w.rows[&table_id][0].cells.contains_key(&old));
        column.property_definition_id
    };
    let cmd = command(&world, table_id, "Plus ones", DataType::Number);
    svc.change_column_type(receipt(db, OWNER, AccessLevel::Edit), viewer(OWNER), cmd)
        .await
        .unwrap();
    let w = world.lock().unwrap();
    let column = w
        .columns
        .iter()
        .find(|c| {
            c.table_id == table_id
                && c.property_definition_id != old
                && w.definitions[&c.property_definition_id]
                    .definition
                    .display_name
                    == "Plus ones"
        })
        .unwrap();
    assert_eq!(
        w.rows[&table_id][0].cells[&column.property_definition_id],
        PropertyValue::Num(2.0)
    );
    assert!(w.definitions.contains_key(&new_id));
}

#[tokio::test]
async fn invalid_or_lossy_conversions_do_not_modify_the_column() {
    for value in ["0012", "9007199254740993", "2.00", " 2", "hello"] {
        let (world, svc, db, table_id) = seeded().await;
        let cmd = command(&world, table_id, "Name", DataType::Number);
        let (old, count) = {
            let mut w = world.lock().unwrap();
            let old = w
                .columns
                .iter()
                .find(|c| c.id == cmd.column_id)
                .unwrap()
                .property_definition_id;
            w.rows.get_mut(&table_id).unwrap()[0]
                .cells
                .insert(old, PropertyValue::Str(value.into()));
            (old, w.definitions.len())
        };
        assert!(matches!(
            svc.change_column_type(
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
        assert_eq!(
            w.rows[&table_id][0].cells[&old],
            PropertyValue::Str(value.into())
        );
    }
}

#[tokio::test]
async fn selecting_text_preserves_option_labels_and_select_preserves_unused_options() {
    let (world, svc, db, table_id) = seeded().await;
    let mut cmd = command(&world, table_id, "Status", DataType::SelectString);
    cmd.is_multi_select = true;
    svc.change_column_type(receipt(db, OWNER, AccessLevel::Edit), viewer(OWNER), cmd)
        .await
        .unwrap();
    let cmd = command(&world, table_id, "Status", DataType::String);
    {
        let w = world.lock().unwrap();
        let col = w.columns.iter().find(|c| c.id == cmd.column_id).unwrap();
        assert_eq!(
            w.definitions[&col.property_definition_id]
                .property_options
                .len(),
            2
        );
    }
    svc.change_column_type(
        receipt(db, OWNER, AccessLevel::Edit),
        viewer(OWNER),
        cmd.clone(),
    )
    .await
    .unwrap();
    let w = world.lock().unwrap();
    let col = w.columns.iter().find(|c| c.id == cmd.column_id).unwrap();
    assert_eq!(
        w.rows[&table_id][0].cells[&col.property_definition_id],
        PropertyValue::Str("Going".into())
    );
}

#[tokio::test]
async fn reorder_validates_complete_ids_and_delete_preserves_definitions() {
    let (world, svc, db, table_id) = seeded().await;
    let (ids, version) = {
        let w = world.lock().unwrap();
        (
            w.columns.iter().map(|c| c.id).collect::<Vec<_>>(),
            w.tables[0].version,
        )
    };
    for invalid in [
        vec![],
        vec![ids[0]; ids.len()],
        vec![Uuid::new_v4(); ids.len()],
    ] {
        assert!(matches!(
            svc.reorder_columns(
                receipt(db, OWNER, AccessLevel::Edit),
                table_id,
                invalid,
                version
            )
            .await,
            Err(DatabaseError::InvalidSchemaOperation(_))
        ));
    }
    let reversed = ids.iter().copied().rev().collect();
    let result = svc
        .reorder_columns(
            receipt(db, OWNER, AccessLevel::Edit),
            table_id,
            reversed,
            version,
        )
        .await
        .unwrap();
    let before = world.lock().unwrap().definitions.len();
    let result = svc
        .delete_column(
            receipt(db, OWNER, AccessLevel::Edit),
            table_id,
            ids[0],
            result.table_versions[&table_id],
        )
        .await
        .unwrap();
    let w = world.lock().unwrap();
    assert!(!w.columns.iter().any(|c| c.id == ids[0]));
    assert_eq!(w.definitions.len(), before);
    assert_eq!(
        result.table_versions[&table_id],
        TableVersion(version.0 + 2)
    );
}

#[tokio::test]
async fn schema_mutations_reject_wrong_database_stale_and_trashed_database() {
    for scenario in ["wrong_database", "stale", "trashed"] {
        let (world, svc, db, table_id) = seeded().await;
        let mut cmd = command(&world, table_id, "Name", DataType::String);
        let receipt_id = if scenario == "wrong_database" {
            Uuid::new_v4()
        } else {
            db
        };
        if scenario == "stale" {
            cmd.base_version.0 -= 1;
        }
        if scenario == "trashed" {
            world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
        }
        assert!(
            svc.change_column_type(
                receipt(receipt_id, OWNER, AccessLevel::Edit),
                viewer(OWNER),
                cmd.clone()
            )
            .await
            .is_err()
        );
        assert!(
            svc.delete_column(
                receipt(receipt_id, OWNER, AccessLevel::Edit),
                table_id,
                cmd.column_id,
                cmd.base_version
            )
            .await
            .is_err()
        );
        let ids = world.lock().unwrap().columns.iter().map(|c| c.id).collect();
        assert!(
            svc.reorder_columns(
                receipt(receipt_id, OWNER, AccessLevel::Edit),
                table_id,
                ids,
                cmd.base_version
            )
            .await
            .is_err()
        );
    }
}

#[tokio::test]
async fn lookup_dependencies_prevent_deleting_or_retyping_their_source_column() {
    let (world, svc, db, table_id) = seeded().await;
    let cmd = command(&world, table_id, "Name", DataType::String);
    {
        let mut w = world.lock().unwrap();
        let mut lookup = w.columns[0].clone();
        lookup.id = Uuid::now_v7();
        lookup.config = Some(ColumnConfig::Lookup {
            via_column_id: cmd.column_id,
            target: "Name".into(),
        });
        w.columns.push(lookup);
    }
    assert!(matches!(
        svc.change_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            cmd.clone()
        )
        .await,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
    assert!(matches!(
        svc.delete_column(
            receipt(db, OWNER, AccessLevel::Edit),
            table_id,
            cmd.column_id,
            cmd.base_version
        )
        .await,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
}
