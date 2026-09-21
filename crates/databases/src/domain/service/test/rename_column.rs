use super::*;

fn name_column(world: &Shared, table_id: TableId) -> Column {
    world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.table_id == table_id)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn label_rename_preserves_property_binding_sql_and_live_answer_and_retries_idempotently() {
    let (world, svc, db, table_id) = seeded().await;
    let column = name_column(&world, table_id);
    let sql = format!("SELECT name FROM {}", catalog::read_table_name(table_id));
    let before = svc.query_sql(viewer(OWNER), sql.clone()).await.unwrap();
    let version = world.lock().unwrap().tables[0].version;
    let result = svc
        .rename_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            column.id,
            "  Task  ".into(),
            "Name".into(),
        )
        .await
        .unwrap();
    assert_eq!(result.column.id, column.id);
    assert_eq!(
        result.column.property_definition_id,
        column.property_definition_id
    );
    assert_eq!(result.column.display_name.as_deref(), Some("Task"));
    assert_eq!(result.table_version, TableVersion(version.0 + 1));
    assert_eq!(
        world.lock().unwrap().published.last(),
        Some(&(table_id, result.table_version))
    );
    assert_eq!(
        text_cells(&svc.query_sql(viewer(OWNER), sql).await.unwrap()),
        text_cells(&before)
    );
    let detail = svc
        .get_database(
            receipt::<ViewAccessLevel>(db, VIEWER, AccessLevel::View),
            viewer(VIEWER),
        )
        .await
        .unwrap();
    let renamed = detail.tables[0]
        .columns
        .iter()
        .find(|entry| entry.column.id == column.id)
        .unwrap();
    assert_eq!(renamed.sql_name, "name");
    assert_eq!(renamed.definition.definition.display_name, "Name");
    assert_eq!(renamed.column.display_name.as_deref(), Some("Task"));

    let retried = svc
        .rename_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            column.id,
            "Task".into(),
            "Name".into(),
        )
        .await
        .unwrap();
    assert_eq!(retried.table_version, result.table_version);
    let error = svc
        .rename_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            column.id,
            "Work item".into(),
            "Name".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::InvalidSchemaOperation(_)));
    assert_eq!(
        name_column(&world, table_id).display_name.as_deref(),
        Some("Task")
    );
}

#[tokio::test]
async fn rename_checks_effective_labels_and_creation_respects_renamed_labels() {
    let (world, svc, db, table_id) = seeded().await;
    let name_column = name_column(&world, table_id);
    for invalid in [" ", " status ", &"x".repeat(201)] {
        let error = svc
            .rename_column(
                receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
                table_id,
                name_column.id,
                invalid.into(),
                "Name".into(),
            )
            .await
            .unwrap_err();
        assert!(
            matches!(error, DatabaseError::InvalidSchemaOperation(_)),
            "{invalid}"
        );
    }
    svc.rename_column(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
        table_id,
        name_column.id,
        "Task".into(),
        "Name".into(),
    )
    .await
    .unwrap();
    let other_id = world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|entry| entry.id != name_column.id)
        .unwrap()
        .id;
    let error = svc
        .rename_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            table_id,
            other_id,
            " task ".into(),
            "Status".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::InvalidSchemaOperation(_)));
    let error = svc
        .create_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            CreateColumn {
                infer_type: false,
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: " TASK ".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
                    options: vec![],
                },
                config: None,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::InvalidSchemaOperation(_)));
}

#[tokio::test]
async fn rename_refuses_foreign_columns_tables_and_trashed_database() {
    let (world, svc, db, table_id) = seeded().await;
    let column = name_column(&world, table_id);
    let other = svc
        .create_database(CreateDatabase {
            name: "Other".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap();
    for (receipt_db, target_table, target_column) in [
        (other.id, table_id, column.id),
        (db, Uuid::new_v4(), column.id),
        (db, table_id, Uuid::new_v4()),
    ] {
        let error = svc
            .rename_column(
                receipt::<EditAccessLevel>(receipt_db, OWNER, AccessLevel::Edit),
                target_table,
                target_column,
                "Task".into(),
                "Name".into(),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, DatabaseError::NotFound));
    }
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let error = svc
        .rename_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            table_id,
            column.id,
            "Task".into(),
            "Name".into(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::NotFound));
    assert!(name_column(&world, table_id).display_name.is_none());
}

#[tokio::test]
async fn reusing_a_previous_label_keeps_the_renamed_columns_sql_and_values_intact() {
    let (world, svc, db, table_id) = seeded().await;
    let column = name_column(&world, table_id);
    let sql = format!("SELECT name FROM {}", catalog::read_table_name(table_id));
    let before = svc.query_sql(viewer(OWNER), sql.clone()).await.unwrap();
    svc.rename_column(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
        table_id,
        column.id,
        "Task".into(),
        "Name".into(),
    )
    .await
    .unwrap();
    let added_id = svc
        .create_column(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            CreateColumn {
                infer_type: false,
                table_id,
                binding: ColumnBinding::NewDefinition {
                    name: "Name".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
                    options: vec![],
                },
                config: None,
            },
        )
        .await
        .unwrap();
    let detail = svc
        .get_database(
            receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::View),
            viewer(OWNER),
        )
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
    assert_eq!(renamed.sql_name, "name");
    assert_eq!(renamed.column.display_name.as_deref(), Some("Task"));
    assert_ne!(added.sql_name, renamed.sql_name);
    assert_eq!(added.definition.definition.display_name, "Name");
    assert_eq!(
        text_cells(&svc.query_sql(viewer(OWNER), sql).await.unwrap()),
        text_cells(&before)
    );
}
