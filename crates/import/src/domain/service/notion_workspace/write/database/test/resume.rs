//! Resume after committed database and view writes.

use super::*;

#[tokio::test]
async fn a_database_stopped_part_way_through_its_rows_resumes_without_duplicates() {
    // 600 rows: two insert batches, the second lost with its process.
    let notion = FakeNotion {
        views: Vec::new(),
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Accounts".to_string(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: Vec::new(),
        },
        rows: (1..=600).map(numbered_row).collect(),
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    *writer.fail_at_batch.lock().unwrap() = Some(2);
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Accounts");

    let first = write_database(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &Progress::new(&store, &user, item.import_id, &[]),
        &Cancel::default(),
        None,
    )
    .await;
    assert_eq!(first.unwrap_err().to_string(), "the process stopped");
    assert_eq!(inserted(&writer.batches.lock().unwrap()), 500);

    // Another process resumes from what was recorded.
    *writer.fail_at_batch.lock().unwrap() = None;
    let recorded = store.written(&user, &[item.import_id]).await.unwrap();
    let written = write_database(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &Progress::new(&store, &user, item.import_id, &recorded),
        &Cancel::default(),
        None,
    )
    .await
    .unwrap();

    assert_eq!(*writer.databases.lock().unwrap(), 1, "one database");
    let batches = writer.batches.lock().unwrap();
    let schemas = batches
        .iter()
        .filter(|batch| {
            batch.iter().any(|op| {
                matches!(
                    op,
                    DatabaseOp::Table {
                        change: TableChange::Rename { .. },
                        ..
                    }
                )
            })
        })
        .count();
    assert_eq!(schemas, 1, "the schema is written once");
    assert_eq!(inserted(&batches), 600, "every row once");
    assert_eq!(written.rows.len(), 600);
    let distinct: HashSet<RowId> = written.rows.values().map(|row| row.row).collect();
    assert_eq!(distinct.len(), 600);
    assert_eq!(written.database_id, DATABASE);
}

#[tokio::test]
async fn resumed_row_bodies_are_neither_read_nor_created_again() {
    let notion = FakeNotion {
        views: Vec::new(),
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Bugs".to_string(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: Vec::new(),
        },
        rows: vec![
            notion_row('1', "Login fails", vec![]),
            notion_row('2', "Typo", vec![]),
        ],
        bodies: [
            (id('1'), "Steps".to_string()),
            (id('2'), "Where".to_string()),
        ]
        .into_iter()
        .collect(),
    };
    let writer = FakeWriter::default();
    // Schema, rows, then the Page column, which the stop takes down.
    *writer.fail_at_batch.lock().unwrap() = Some(2);
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Bugs");

    write_database(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &Progress::new(&store, &user, item.import_id, &[]),
        &Cancel::default(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(*notion.fetched.lock().unwrap(), 2);
    assert_eq!(writer.documents.lock().unwrap().len(), 2);

    *writer.fail_at_batch.lock().unwrap() = None;
    let recorded = store.written(&user, &[item.import_id]).await.unwrap();
    write_database(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &Progress::new(&store, &user, item.import_id, &recorded),
        &Cancel::default(),
        None,
    )
    .await
    .unwrap();

    assert_eq!(*notion.fetched.lock().unwrap(), 2, "no body is read twice");
    assert_eq!(writer.documents.lock().unwrap().len(), 2);
    assert_eq!(
        writer.folders.lock().unwrap().len(),
        1,
        "the bodies folder is reused"
    );
    let batches = writer.batches.lock().unwrap();
    assert_eq!(inserted(&batches), 2);
    // The Page column, then its two links.
    let DatabaseOp::Rows {
        change:
            RowsChange::Update {
                changes: RowChanges::PerRow { rows: linked },
            },
        ..
    } = &batches[batches.len() - 1][0]
    else {
        panic!("expected the Page links, got {:?}", batches.last());
    };
    assert_eq!(linked.len(), 2);
}

#[tokio::test]
async fn a_committed_view_with_a_lost_response_is_reused_before_its_marker_is_written() {
    let view: import_notion::domain::views::NotionView =
        serde_json::from_value(serde_json::json!({
            "id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "name":"Open", "type":"table",
            "parent":{"database_id":"ffffffffffffffffffffffffffffffff"},
            "data_source_id":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            "filter":{"property":"missing","people":{"contains":"me"}}
        }))
        .unwrap();
    let view_id = view.id.clone();
    let notion = FakeNotion {
        views: vec![view],
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Work".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![],
        },
        rows: vec![],
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    *writer.fail_after_view.lock().unwrap() = true;
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Work");
    assert_eq!(
        prepare_database(
            &notion,
            &writer,
            &user,
            &item,
            Some(Uuid::from_u128(42)),
            &Progress::new(&store, &user, item.import_id, &[]),
            &Cancel::default(),
        )
        .await
        .err()
        .unwrap()
        .to_string(),
        "lost view response"
    );
    let recorded = store.written(&user, &[item.import_id]).await.unwrap();
    assert!(
        !recorded
            .iter()
            .any(|object| object.kind == WrittenKind::View)
    );
    let progress = Progress::new(&store, &user, item.import_id, &recorded);
    let prepared = prepare_database(
        &notion,
        &writer,
        &user,
        &item,
        Some(Uuid::from_u128(42)),
        &progress,
        &Cancel::default(),
    )
    .await
    .unwrap();
    assert_eq!(*writer.databases.lock().unwrap(), 1);
    assert_eq!(writer.saved_views.lock().unwrap().len(), 1);
    assert_eq!(prepared.views.len(), 1);
    assert_eq!(
        writer
            .batches
            .lock()
            .unwrap()
            .iter()
            .flatten()
            .filter(|op| matches!(op, DatabaseOp::View { .. }))
            .count(),
        1
    );
    assert!(
        progress
            .get_for(WrittenKind::View, view_id.as_str())
            .is_some()
    );
    progress.flush_warnings().await.unwrap();
    assert_eq!(
        store.warnings.lock().unwrap().len(),
        1,
        "the view loss survives without duplicate report entries"
    );
}

#[tokio::test]
async fn rows_are_read_again_after_reservation_and_schema_drift_is_reported() {
    let mut notion = FakeNotion {
        views: vec![],
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Schedule".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "dates".into(),
                name: "Dates".into(),
                kind: NotionPropertyKind::Date,
            }],
        },
        rows: vec![notion_row('1', "Old", vec![])],
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Schedule");
    let progress = Progress::new(&store, &user, item.import_id, &[]);
    let prepared = prepare_database(
        &notion,
        &writer,
        &user,
        &item,
        Some(Uuid::from_u128(42)),
        &progress,
        &Cancel::default(),
    )
    .await
    .unwrap();
    notion.source.properties.clear();
    notion.rows = vec![notion_row(
        '2',
        "New",
        vec![(
            "Dates",
            NotionValue::Date {
                start: "2026-11-17".into(),
                end: Some("2026-11-19".into()),
            },
        )],
    )];
    let written = write_prepared_database(
        &notion,
        &writer,
        &user,
        &item,
        false,
        &PeopleMap::new(),
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &progress,
        &Cancel::default(),
        &prepared,
        &HashMap::new(),
        None,
    )
    .await
    .unwrap();
    assert!(
        written.rows.contains_key(&id('2')),
        "write-time rows replace the scan snapshot"
    );
    assert!(!written.rows.contains_key(&id('1')));
    progress.flush_warnings().await.unwrap();
    let losses = store.warnings.lock().unwrap();
    assert!(
        losses
            .iter()
            .any(|loss| loss.contains("property Dates") && loss.contains("changed"))
    );
    assert!(
        losses
            .iter()
            .any(|loss| loss.contains("end date") && loss.contains("Dates"))
    );
}

#[tokio::test]
async fn audit_resumed_schema_keeps_its_date_shape_without_scanning_rows() {
    let mut notion = FakeNotion {
        views: vec![],
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Schedule".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "dates".into(),
                name: "Dates".into(),
                kind: NotionPropertyKind::Date,
            }],
        },
        rows: vec![notion_row('1', "Release", vec![])],
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Schedule");
    prepare_database(
        &notion,
        &writer,
        &user,
        &item,
        Some(Uuid::from_u128(42)),
        &Progress::new(&store, &user, item.import_id, &[]),
        &Cancel::default(),
    )
    .await
    .unwrap();
    notion.rows[0].properties.insert(
        "Dates".into(),
        NotionValue::Date {
            start: "2026-11-17".into(),
            end: Some("2026-11-19".into()),
        },
    );
    let recorded = store.written(&user, &[item.import_id]).await.unwrap();
    let progress = Progress::new(&store, &user, item.import_id, &recorded);
    *notion.queries.lock().unwrap() = 0;
    let resumed = prepare_database(
        &notion,
        &writer,
        &user,
        &item,
        Some(Uuid::from_u128(42)),
        &progress,
        &Cancel::default(),
    )
    .await
    .unwrap();
    progress.flush_warnings().await.unwrap();
    assert_eq!(resumed.plan.columns[0].shape, ColumnShape::Date);
    assert_eq!(
        *notion.queries.lock().unwrap(),
        0,
        "durable schema facts avoid another full scan"
    );
    assert_eq!(
        writer.batches.lock().unwrap().len(),
        1,
        "the written schema is reused"
    );
}

#[tokio::test]
async fn a_column_rename_and_added_option_do_not_block_schema_resume() {
    use import_notion::domain::model::NotionOption;
    let mut notion = FakeNotion {
        views: vec![],
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        rows: vec![],
        bodies: HashMap::new(),
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Work".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "status".into(),
                name: "Stage".into(),
                kind: NotionPropertyKind::Select {
                    options: vec![NotionOption {
                        id: "open".into(),
                        name: "Open".into(),
                        color: "blue".into(),
                    }],
                },
            }],
        },
    };
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Work");
    prepare_database(
        &notion,
        &writer,
        &user,
        &item,
        Some(Uuid::from_u128(42)),
        &Progress::new(&store, &user, item.import_id, &[]),
        &Cancel::default(),
    )
    .await
    .unwrap();
    notion.source.properties[0].name = "Workflow".into();
    let NotionPropertyKind::Select { options } = &mut notion.source.properties[0].kind else {
        unreachable!()
    };
    options.push(NotionOption {
        id: "done".into(),
        name: "Done".into(),
        color: "green".into(),
    });
    let recorded = store.written(&user, &[item.import_id]).await.unwrap();
    let result = prepare_database(
        &notion,
        &writer,
        &user,
        &item,
        Some(Uuid::from_u128(42)),
        &Progress::new(&store, &user, item.import_id, &recorded),
        &Cancel::default(),
    )
    .await;
    assert!(
        result.is_ok(),
        "names and declared options do not change the reserved column types"
    );
    assert_eq!(
        writer.batches.lock().unwrap().len(),
        1,
        "the reserved schema is reused"
    );
}

#[tokio::test]
async fn audit_reservation_scan_checks_cancellation_between_pages() {
    let cancel = std::sync::Arc::new(Cancel::default());
    let notion = FakeNotion {
        views: vec![],
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: Some(cancel.clone()),
        paginated: true,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Schedule".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "dates".into(),
                name: "Dates".into(),
                kind: NotionPropertyKind::Date,
            }],
        },
        rows: vec![],
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Schedule");
    let result = write_database(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &Progress::new(&store, &user, item.import_id, &[]),
        &cancel,
        None,
    )
    .await;
    assert!(result.is_err());
    assert_eq!(
        *notion.queries.lock().unwrap(),
        1,
        "stop before reading the second page"
    );
}
