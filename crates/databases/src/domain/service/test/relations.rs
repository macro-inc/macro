use super::*;

async fn linked_fixture() -> (Shared, Service, DatabaseId, TableId, TableId, ColumnId) {
    let (world, svc, db, guests) = seeded().await;
    let sessions = svc
        .create_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id: db,
                name: "Sessions".into(),
            },
        )
        .await
        .unwrap();
    add_column(
        &svc,
        db,
        sessions.id,
        "Title",
        DataType::String,
        false,
        None,
    )
    .await;
    let column = add_column(
        &svc,
        db,
        guests,
        "Sessions",
        DataType::Entity,
        false,
        Some(ColumnConfig::Link {
            database_id: db,
            table_id: sessions.id,
        }),
    )
    .await;
    (world, svc, db, guests, sessions.id, column)
}

#[tokio::test]
async fn link_materialization_accepts_the_exact_cap_and_fetches_each_column_once() {
    let (world, svc, _, guests, _, column) = linked_fixture().await;
    let source = world.lock().unwrap().rows[&guests][0].id;
    world.lock().unwrap().links.insert(
        column,
        (1..=MAX_MATERIALIZED_ROWS)
            .map(|index| (source, Uuid::from_u128(index as u128)))
            .collect(),
    );
    let catalog = svc.build_catalog(&viewer(OWNER)).await.unwrap();
    let entry = catalog
        .entries
        .iter()
        .find(|entry| entry.table.id == guests)
        .unwrap();
    let mut loaded = Loaded::default();

    svc.load_table(entry, &mut loaded).await.unwrap();
    svc.load_table(entry, &mut loaded).await.unwrap();

    assert_eq!(loaded.links[&column][&source].len(), MAX_MATERIALIZED_ROWS);
    assert_eq!(
        world.lock().unwrap().fetch_link_limits,
        vec![MAX_MATERIALIZED_ROWS + 1],
        "the repository receives the cap plus one, and cached links are not fetched twice"
    );
}

#[tokio::test]
async fn oversized_links_reject_reads_and_writes_before_applying_changes() {
    let (world, svc, _, guests, _, column) = linked_fixture().await;
    {
        let mut world = world.lock().unwrap();
        let source = world.rows[&guests][0].id;
        world.links.insert(
            column,
            (1..=MAX_MATERIALIZED_ROWS + 2)
                .map(|index| (source, Uuid::from_u128(index as u128)))
                .collect(),
        );
        world.applied.clear();
    }

    for sql in [
        "SELECT name FROM guests",
        "SELECT * FROM guests__sessions",
        "UPDATE guests SET name = 'Must not commit'",
    ] {
        assert!(matches!(
            exec(&svc, OWNER, sql).await,
            Err(QueryError::BudgetExceeded)
        ));
    }

    let world = world.lock().unwrap();
    assert!(world.applied.is_empty());
    assert_eq!(world.fetch_link_limits, vec![MAX_MATERIALIZED_ROWS + 1; 3]);
}

#[tokio::test]
async fn changing_a_link_column_type_checks_only_one_existing_edge() {
    let (world, svc, db, guests, _, column) = linked_fixture().await;
    let base_version = {
        let mut world = world.lock().unwrap();
        let source = world.rows[&guests][0].id;
        world.links.insert(
            column,
            vec![(source, Uuid::now_v7()), (source, Uuid::now_v7())],
        );
        world
            .tables
            .iter()
            .find(|table| table.id == guests)
            .unwrap()
            .version
    };

    let result = svc
        .change_column_type(
            receipt(db, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            ChangeColumnType {
                table_id: guests,
                column_id: column,
                data_type: DataType::String,
                is_multi_select: false,
                specific_entity_type: None,
                relation: None,
                base_version,
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(DatabaseError::InvalidSchemaOperation(_))
    ));
    assert_eq!(world.lock().unwrap().fetch_link_limits, vec![1]);
}

#[tokio::test]
async fn same_exec_new_source_and_target_link_by_server_minted_ids() {
    let (world, svc, _, guests, sessions, column) = linked_fixture().await;
    let result = exec(
        &svc,
        OWNER,
        "INSERT INTO guests (name) VALUES ('New guest');
         INSERT INTO sessions (title) VALUES ('New session');
         INSERT INTO guests__sessions (row_id, linked_id)
         SELECT g.row_id, s.row_id FROM guests g, sessions s
         WHERE g.row_id LIKE 'new:%' AND s.row_id LIKE 'new:%'",
    )
    .await
    .unwrap();
    assert_eq!(result.inserted_row_ids.len(), 2);
    assert_eq!(result.changes_applied, 3);
    assert!(result.new_versions.contains_key(&guests));
    assert!(result.new_versions.contains_key(&sessions));
    let linked = exec(
        &svc,
        OWNER,
        "SELECT g.name, s.title FROM guests g
         JOIN guests__sessions j ON j.row_id = g.row_id
         JOIN sessions s ON s.row_id = j.linked_id",
    )
    .await
    .unwrap();
    assert_eq!(text_cells(&linked), vec![vec!["New guest", "New session"]]);
    let w = world.lock().unwrap();
    let (source, target) = w.links[&column][0];
    assert!(result.inserted_row_ids.contains(&source));
    assert!(result.inserted_row_ids.contains(&target));
    assert_eq!(source.get_version_num(), 7);
    assert_eq!(target.get_version_num(), 7);
}

#[tokio::test]
async fn invalid_target_or_view_only_insert_leaves_no_partial_new_row() {
    let (world, svc, _, guests, _, _) = linked_fixture().await;
    let before = world.lock().unwrap().rows[&guests].len();
    let sql = format!(
        "INSERT INTO guests (name) VALUES ('Must not commit');
        INSERT INTO guests__sessions (row_id, linked_id)
        SELECT row_id, '{}' FROM guests WHERE row_id LIKE 'new:%'",
        Uuid::new_v4()
    );
    assert!(matches!(
        exec(&svc, OWNER, &sql).await,
        Err(QueryError::UntranslatableChange(_))
    ));
    assert!(matches!(
        exec(&svc, VIEWER, &sql).await,
        Err(QueryError::ReadOnly(_))
    ));
    assert_eq!(world.lock().unwrap().rows[&guests].len(), before);
}

#[tokio::test]
async fn target_version_conflict_rolls_back_same_exec_source_insert() {
    let (world, svc, _, guests, sessions, _) = linked_fixture().await;
    exec(
        &svc,
        OWNER,
        "INSERT INTO sessions (title) VALUES ('Existing')",
    )
    .await
    .unwrap();
    let snapshot = exec(&svc, OWNER, "SELECT row_id FROM sessions")
        .await
        .unwrap();
    exec(&svc, OWNER, "UPDATE sessions SET title = 'Changed'")
        .await
        .unwrap();
    let before = world.lock().unwrap().rows[&guests].len();
    let result = svc
        .exec_sql(
            viewer(OWNER),
            ExecRequest {
                sql: "INSERT INTO guests DEFAULT VALUES;
            INSERT INTO guests__sessions (row_id, linked_id)
            SELECT g.row_id, s.row_id FROM guests g, sessions s WHERE g.row_id LIKE 'new:%'"
                    .into(),
                base_versions: Some(snapshot.read_versions),
            },
        )
        .await;
    assert!(
        matches!(result, Err(QueryError::VersionConflict { table_id }) if table_id == sessions)
    );
    assert_eq!(world.lock().unwrap().rows[&guests].len(), before);
}

#[tokio::test]
async fn created_then_deleted_target_cannot_be_linked() {
    let (world, svc, _, guests, _, _) = linked_fixture().await;
    let before = world.lock().unwrap().rows[&guests].len();
    let result = exec(
        &svc,
        OWNER,
        "INSERT INTO guests DEFAULT VALUES;
         INSERT INTO sessions (title) VALUES ('Temporary');
         INSERT INTO guests__sessions (row_id, linked_id)
         SELECT g.row_id, s.row_id FROM guests g, sessions s
         WHERE g.row_id LIKE 'new:%' AND s.row_id LIKE 'new:%';
         DELETE FROM sessions WHERE row_id LIKE 'new:%'",
    )
    .await;
    assert!(matches!(result, Err(QueryError::UntranslatableChange(_))));
    assert_eq!(world.lock().unwrap().rows[&guests].len(), before);
}

#[tokio::test]
async fn relation_metadata_uses_collision_resolved_junction_and_viewer_capability() {
    let (world, svc, db, guests, _, column) = linked_fixture().await;
    {
        let mut w = world.lock().unwrap();
        let database = w
            .databases
            .iter()
            .find(|database| database.id == db)
            .unwrap();
        let qualified = catalog::qualified_table_name(database, "sessions");
        // This junction now collides with the Sessions table's qualified alias.
        w.tables
            .iter_mut()
            .find(|table| table.id == guests)
            .unwrap()
            .name = qualified.strip_suffix("__sessions").unwrap().to_string();
    }
    for (actor, level, writable) in [
        (OWNER, AccessLevel::Owner, true),
        (VIEWER, AccessLevel::View, false),
    ] {
        let detail = svc
            .get_database(receipt::<ViewAccessLevel>(db, actor, level), viewer(actor))
            .await
            .unwrap();
        let detail = detail.tables.iter().find(|t| t.table.id == guests).unwrap();
        let relation = detail
            .columns
            .iter()
            .find(|c| c.column.id == column)
            .unwrap();
        assert!(!relation.writable);
        assert_eq!(relation.junction_writable, writable);
        assert!(
            relation
                .junction_sql_name
                .as_ref()
                .unwrap()
                .starts_with("_macro_storage_junction_")
        );
        assert_eq!(
            relation.read_junction_sql_name,
            Some(format!("{}__sessions", detail.read_sql_name))
        );
        exec(
            &svc,
            actor,
            &format!(
                "SELECT * FROM \"{}\"",
                relation.read_junction_sql_name.as_ref().unwrap()
            ),
        )
        .await
        .unwrap();
    }
}
