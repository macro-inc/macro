//! Fidelity regressions from a controlled template import.
use super::*;

fn template() -> FakeNotion {
    FakeNotion {
        views: vec![serde_json::from_value(serde_json::json!({
            "id":id('b'), "name":"Active tasks", "type":"table",
            "parent":{"database_id":id('f')}, "data_source_id":id('e'),
            "filter":{"and":[{"property":"title","title":{"contains":"Draft"}},{"property":"owner","people":{"contains":id('2')}}]},
            "sorts":[{"property":"progress","direction":"ascending"}],
            "configuration":{"properties":[{"property_id":"owner","visible":false}]}
        })).unwrap()],
        source: NotionDataSource {
            id:id('e'), database_id:id('f'), title:"Tasks".into(),
            database_parent:NotionParent::Workspace, in_trash:false,
            properties:vec![
                NotionPropertySchema{id:"title".into(),name:"Name".into(),kind:NotionPropertyKind::Title},
                NotionPropertySchema{id:"owner".into(),name:"Owner".into(),kind:NotionPropertyKind::People},
                NotionPropertySchema{id:"start".into(),name:"Start".into(),kind:NotionPropertyKind::Unsupported{notion_type:"button".into()}},
                NotionPropertySchema{id:"progress".into(),name:"Progress".into(),kind:NotionPropertyKind::Formula},
            ],
        },
        rows:vec![notion_row('7',"Draft landing copy",vec![("Owner",NotionValue::People(vec![id('1'),id('2'),id('3')]))])],
        bodies:HashMap::new(), fetched:Mutex::new(0), queries:Mutex::new(0), scan_stop:None, paginated:false,
    }
}

#[tokio::test]
async fn fable_unmapped_people_are_reported_without_losing_mapped_people_or_double_counting_resume()
{
    let notion = template();
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Tasks");
    let people = PeopleMap::from([
        (
            id('1'),
            import_notion::domain::macro_cells::Person {
                email: None,
                macro_user: Some(user.clone()),
            },
        ),
        (
            id('3'),
            import_notion::domain::macro_cells::Person {
                email: None,
                macro_user: None,
            },
        ),
    ]);
    // A prior process left the loss receipt, but never wrote this row.
    let receipt = crate::domain::models::SourceLossFact {
        object: notion.rows[0].id.clone(),
        detail: crate::domain::models::SourceLossDetail::UnmappedPeople {
            source: "Tasks".into(),
            property_id: "owner".into(),
            property: "Owner".into(),
            count: 2,
        },
    };
    store
        .record_written(
            &user,
            &[WrittenObject {
                import_id: item.import_id,
                kind: WrittenKind::Loss,
                object: serde_json::to_string(&receipt).unwrap(),
                macro_id: item.import_id,
            }],
        )
        .await
        .unwrap();
    assert!(
        !store
            .written(&user, &[item.import_id])
            .await
            .unwrap()
            .iter()
            .any(|fact| fact.kind == WrittenKind::Row)
    );
    for _ in 0..2 {
        let known = store.written(&user, &[item.import_id]).await.unwrap();
        write_database(
            &notion,
            &writer,
            &user,
            &item,
            Uuid::from_u128(42),
            false,
            &people,
            &tokio::sync::RwLock::new(NotionLinks::default()),
            &Progress::new(&store, &user, item.import_id, &known),
            &Cancel::default(),
            None,
        )
        .await
        .unwrap();
    }
    let batches = writer.batches.lock().unwrap();
    let inserted: Vec<_> = batches
        .iter()
        .flatten()
        .filter_map(|op| match op {
            DatabaseOp::Rows {
                change: RowsChange::Insert { rows, .. },
                ..
            } => Some(rows),
            _ => None,
        })
        .flatten()
        .flatten()
        .collect();
    assert!(inserted.iter().any(|cell| matches!(&cell.value,CellValue::Entities(users) if users.len()==1 && users[0].entity_id==user.as_ref())));
    let warnings = store.warnings.lock().unwrap();
    let people: Vec<_> = warnings
        .iter()
        .filter(|line| line.contains("Owner") && line.contains("matched to Macro"))
        .collect();
    assert_eq!(
        people.len(),
        1,
        "unmapped assignments must have one cumulative loss line"
    );
    assert_eq!(
        people[0].as_str(),
        "2 people assignments in database “Tasks”, property “Owner”, could not be matched to Macro users and were omitted."
    );
    assert!(
        warnings
            .iter()
            .all(|line| !line.contains(id('2').as_str()) && !line.contains(id('3').as_str()))
    );
}

#[tokio::test]
async fn fable_unsupported_properties_are_reported() {
    let notion = template();
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Tasks");
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
    let warnings = store.warnings.lock().unwrap();
    assert!(
        warnings.iter().any(|line| line.contains("Tasks")
            && line.contains("Start")
            && line.contains("button")
            && line.contains("omitted")),
        "a dropped button property must be reported"
    );
}

#[tokio::test]
async fn fable_view_losses_have_readable_named_reports() {
    let notion = template();
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Tasks");
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
    let warnings = store.warnings.lock().unwrap();
    let view: Vec<_> = warnings
        .iter()
        .filter(|line| line.contains("Active tasks"))
        .collect();
    assert!(view.iter().any(|line| line.contains("Owner")));
    assert!(view.iter().any(|line| line.contains("Progress")));
    assert!(
        view.iter().all(|line| ![
            "configuration.",
            "sorts[",
            "filter.and[",
            "Unsupported predicate"
        ]
        .iter()
        .any(|path| line.contains(path))),
        "view losses must be readable sentences, not importer paths"
    );
}

#[tokio::test]
async fn fable_approximated_views_keep_their_name_with_a_short_visible_marker() {
    let notion = template();
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Tasks");
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
    assert_eq!(*writer.view_names.lock().unwrap(), vec!["Active tasks ≈"]);
}

#[tokio::test]
async fn fable_repeated_filter_losses_keep_their_count_when_paths_are_hidden() {
    let mut notion = template();
    notion.views[0].filter = Some(serde_json::json!({"and":[
        {"property":"owner","people":{"contains":id('2')}},
        {"property":"owner","people":{"does_not_contain":id('3')}}
    ]}));
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Tasks");
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
    assert!(
        store
            .warnings
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains("Active tasks")
                && line.contains("Owner")
                && line.contains("2 filter conditions")),
        "removing paths must not silently merge distinct losses"
    );
}

#[tokio::test]
async fn typed_new_view_and_property_warnings_are_structured_in_the_ledger() {
    let notion = template();
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let item = source_item("Tasks");
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
    let warnings = store.typed_warnings.lock().unwrap();
    assert!(
        warnings
            .iter()
            .all(|warning| !matches!(warning, crate::domain::models::FidelityWarning::Text(_))),
        "fresh imports must not emit legacy Text warnings"
    );
    let values: Vec<_> = warnings
        .iter()
        .map(|warning| serde_json::to_value(warning).unwrap())
        .collect();
    assert!(
        values.iter().any(
            |warning| warning.get("view").and_then(serde_json::Value::as_str)
                == Some("Active tasks")
        ),
        "view loss must be structured, not a Text sentence"
    );
    assert!(
        values.iter().any(
            |warning| warning.get("kind").and_then(serde_json::Value::as_str) == Some("formula")
        ),
        "snapshot kind must be structured"
    );
    assert!(
        values.iter().any(|warning| warning
            .get("notion_type")
            .and_then(serde_json::Value::as_str)
            == Some("button")),
        "omitted properties must be structured"
    );
}
