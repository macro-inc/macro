use super::*;
use import_notion::domain::views::NotionView;

#[tokio::test]
async fn row_body_losses_are_flushed_at_most_once_per_source_phase() {
    let rows: Vec<_> = (1..=8).map(numbered_row).collect();
    let bodies = rows.iter().map(|row| (row.id.clone(), "<database url=\"https://www.notion.so/ffffffffffffffffffffffffffffffff\">Work</database>".to_owned())).collect();
    let notion = FakeNotion { views: vec![serde_json::from_value(serde_json::json!({
        "id": id('b'), "name": "All work", "type": "table", "parent":{"database_id":id('f')}, "data_source_id":id('e')
    })).unwrap()], source: NotionDataSource { id:id('e'), database_id:id('f'), title:"Work".into(), database_parent:NotionParent::Workspace, in_trash:false, properties:vec![] },
        rows, bodies, fetched: Mutex::new(0), queries: Mutex::new(0), scan_stop: None, paginated: false };
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Work");
    write_database(
        &notion,
        &FakeWriter::default(),
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
    .unwrap();
    assert!(
        store
            .warning_updates
            .load(std::sync::atomic::Ordering::SeqCst)
            <= 2,
        "row count must not determine the number of JSON warning rewrites"
    );
    assert!(
        store
            .warnings
            .lock()
            .unwrap()
            .iter()
            .any(|loss| loss.contains("default tab assumed"))
    );
}

#[tokio::test]
async fn an_unavailable_saved_view_keeps_an_editable_default_database_card() {
    let row = id('1');
    let notion = FakeNotion { views: vec![serde_json::from_value(serde_json::json!({
        "id": id('b'), "name": "All work", "type": "table", "parent":{"database_id":id('f')}, "data_source_id":id('e')
    })).unwrap()], source: NotionDataSource { id:id('e'), database_id:id('f'), title:"Work".into(), database_parent:NotionParent::Workspace, in_trash:false, properties:vec![] },
        rows:vec![], bodies:HashMap::from([(row.clone(), "<database url=\"https://www.notion.so/ffffffffffffffffffffffffffffffff?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\">Work</database>".into())]), fetched: Mutex::new(0), queries: Mutex::new(0), scan_stop: None, paginated: false };
    let destinations = HashMap::from([(
        id('e'),
        crate::domain::service::notion_workspace::databases::DatabaseDestination::Ready(
            crate::domain::ports::ImportedDatabase {
                database_id: DATABASE,
                table: models_databases::TableId::from_uuid(TABLE),
                views: Vec::new(),
            },
        ),
    )]);
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Work");
    let (_, links) = crate::domain::service::notion_workspace::databases::body_links(
        &notion,
        &row,
        &destinations,
        &Progress::new(&store, &user, item.import_id, &[]),
    )
    .await
    .unwrap();
    assert!(matches!(
        links[0].target,
        crate::domain::ports::NotionDatabaseTarget::Resolved {
            database_id: DATABASE,
            view_id: None,
            ..
        }
    ));
}

#[tokio::test]
async fn saved_view_names_are_readable_and_unique_without_notion_identifiers() {
    let views:Vec<NotionView> = [id('b'),id('c')].into_iter().map(|view|serde_json::from_value(serde_json::json!({ "id":view, "name":"Work", "type":"table", "parent":{"database_id":id('f')}, "data_source_id":id('e') })).unwrap()).collect();
    let notion = FakeNotion {
        views,
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
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
    };
    let writer = FakeWriter::default();
    let user = user();
    let item = source_item("Work");
    let store = FakeStore::default();
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
    let names = writer.view_names.lock().unwrap();
    assert_eq!(names.len(), 2);
    assert_ne!(names[0], names[1]);
    assert!(
        names
            .iter()
            .all(|name| !name.contains(id('b').as_str()) && !name.contains(id('c').as_str()))
    );
}

#[tokio::test]
async fn resumed_body_markers_restore_counted_losses_without_rereading_bodies() {
    let rows: Vec<_> = (1..=8).map(numbered_row).collect();
    let bodies = rows.iter().map(|row| (row.id.clone(), "<database url=\"https://www.notion.so/ffffffffffffffffffffffffffffffff\">Work</database>".to_owned())).collect();
    let notion = FakeNotion { views: vec![serde_json::from_value(serde_json::json!({
        "id": id('b'), "name": "All work", "type": "table", "parent":{"database_id":id('f')}, "data_source_id":id('e')
    })).unwrap()], source: NotionDataSource { id:id('e'), database_id:id('f'), title:"Work".into(), database_parent:NotionParent::Workspace, in_trash:false, properties:vec![] },
        rows, bodies, fetched: Mutex::new(0), queries: Mutex::new(0), scan_stop: None, paginated: false };
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Work");
    let writer = FakeWriter::default();
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
    .unwrap();
    let reads = *notion.fetched.lock().unwrap();
    let recorded = store.written(&user, &[item.import_id]).await.unwrap();
    // Only written markers survive an interruption before the aggregate warning flush.
    store.warnings.lock().unwrap().clear();
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
    assert_eq!(
        *notion.fetched.lock().unwrap(),
        reads,
        "completed bodies are not read again"
    );
    assert!(
        store
            .warnings
            .lock()
            .unwrap()
            .iter()
            .any(|loss| loss.contains("8") && loss.contains("default tab assumed"))
    );
}

#[tokio::test]
async fn resumed_selects_keep_reserved_option_ids_and_report_omissions() {
    use import_notion::domain::model::{NotionOption, NotionOptionValue};
    let mut notion = FakeNotion {
        views: vec![],
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        bodies: HashMap::new(),
        rows: vec![],
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Work".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "stage".into(),
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
    let store = FakeStore::default();
    let writer = FakeWriter::default();
    let user = user();
    let item = source_item("Work");
    let initial = prepare_database(
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
    let ColumnShape::Select { options, .. } = &initial.plan.columns[0].shape else {
        panic!("select column required")
    };
    let reserved = options[0].0;
    notion.source.properties[0].name = "Workflow".into();
    let NotionPropertyKind::Select { options } = &mut notion.source.properties[0].kind else {
        unreachable!()
    };
    options[0].name = "Available".into();
    options.push(NotionOption {
        id: "new".into(),
        name: "New".into(),
        color: "red".into(),
    });
    notion.rows = vec![
        notion_row(
            '1',
            "Renamed",
            vec![(
                "Workflow",
                NotionValue::Option(NotionOptionValue {
                    id: Some("open".into()),
                    name: "Available".into(),
                }),
            )],
        ),
        notion_row(
            '2',
            "Unknown id",
            vec![(
                "Workflow",
                NotionValue::Option(NotionOptionValue {
                    id: Some("new".into()),
                    name: "Open".into(),
                }),
            )],
        ),
        notion_row(
            '3',
            "By name",
            vec![("Workflow", NotionValue::Option("Open".into()))],
        ),
        notion_row(
            '4',
            "Unknown name",
            vec![("Workflow", NotionValue::Option("New".into()))],
        ),
    ];
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
    let batches = writer.batches.lock().unwrap();
    let cells = batches
        .iter()
        .flatten()
        .find_map(|op| match op {
            DatabaseOp::Rows {
                change: RowsChange::Insert { rows, .. },
                ..
            } => Some(rows),
            _ => None,
        })
        .unwrap();
    for index in [0, 2] {
        assert_eq!(
            cells[index][1].value,
            CellValue::Options(vec![models_databases::OptionRef::Id(reserved)])
        );
    }
    for index in [1, 3] {
        assert_eq!(cells[index].len(), 1);
    }
    let losses = store.warnings.lock().unwrap();
    assert!(
        losses
            .iter()
            .any(|loss| loss.contains("Open") && loss.contains("option id"))
    );
    assert!(
        losses
            .iter()
            .any(|loss| loss.contains("New") && loss.contains("option name"))
    );
    assert!(
        losses
            .iter()
            .any(|loss| loss.contains("property names or choices changed"))
    );
}

#[tokio::test]
async fn a_legacy_schema_without_planning_facts_reports_how_to_reimport() {
    let notion = FakeNotion {
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
            properties: vec![],
        },
    };
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Work");
    let recorded: Vec<_> = [
        (WrittenKind::Database, DATABASE),
        (WrittenKind::Table, TABLE),
        (WrittenKind::TitleColumn, TITLE_COLUMN),
        (WrittenKind::Schema, DATABASE),
    ]
    .into_iter()
    .map(|(kind, id)| WrittenObject::own(item.import_id, kind, id))
    .collect();
    let result = write_database(
        &notion,
        &FakeWriter::default(),
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
    .await;
    assert!(result.is_err());
    assert!(
        store
            .warnings
            .lock()
            .unwrap()
            .iter()
            .any(|warning| warning.contains("Work") && warning.contains("re-import"))
    );
}
