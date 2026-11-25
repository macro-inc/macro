use super::*;

#[tokio::test]
async fn task_lists_apply_the_reviewed_link_policy_to_each_task_and_folder() {
    use crate::domain::{ports::ImportVisibility, service::notion_workspace::write::write_tasks};
    for (shared, expected) in [
        (false, ImportVisibility::Personal),
        (true, ImportVisibility::Shared),
    ] {
        let notion = FakeNotion {
            views: Vec::new(),
            fetched: Mutex::new(0),
            queries: Mutex::new(0),
            scan_stop: None,
            paginated: false,
            source: NotionDataSource {
                id: id('e'),
                database_id: id('f'),
                title: "Tasks".into(),
                database_parent: NotionParent::Workspace,
                in_trash: false,
                properties: Vec::new(),
            },
            rows: vec![
                notion_row('1', "First task", vec![]),
                notion_row('2', "Second task", vec![]),
            ],
            bodies: [(id('1'), "Task body".into())].into(),
        };
        let writer = FakeWriter {
            task_notice: (!shared)
                .then_some(crate::domain::ports::TaskImportNoticeReason::PersonalAssigneeOmitted),
            ..Default::default()
        };
        let store = FakeStore::default();
        let user = user();
        let mut item = source_item("Tasks");
        item.shared = shared;
        let progress = Progress::new(&store, &user, item.import_id, &[]);
        write_tasks(
            &notion,
            &writer,
            &user,
            &item,
            Uuid::from_u128(42),
            shared,
            &PeopleMap::new(),
            &tokio::sync::RwLock::new(NotionLinks::default()),
            &HashMap::new(),
            &progress,
            &Cancel::default(),
            None,
        )
        .await
        .unwrap();
        let notices = store.notices.lock().unwrap();
        assert_eq!(notices.len(), if shared { 0 } else { 2 });
        assert!(
            notices
                .iter()
                .all(|((source, _), reason)| *source == item.import_id
                    && *reason
                        == crate::domain::ports::TaskImportNoticeReason::PersonalAssigneeOmitted)
        );
        assert_eq!(*writer.tasks.lock().unwrap(), vec![expected, expected]);
        assert_eq!(*writer.folder_visibilities.lock().unwrap(), vec![expected]);
    }
}

#[tokio::test]
async fn private_destinations_override_old_body_and_task_folder_markers() {
    use crate::domain::service::notion_workspace::write::write_tasks;
    for kind in [WrittenKind::BodiesFolder, WrittenKind::TasksFolder] {
        let notion = FakeNotion {
            views: Vec::new(),
            fetched: Mutex::new(0),
            queries: Mutex::new(0),
            scan_stop: None,
            paginated: false,
            source: NotionDataSource {
                id: id('e'),
                database_id: id('f'),
                title: "Items".into(),
                database_parent: NotionParent::Workspace,
                in_trash: false,
                properties: Vec::new(),
            },
            rows: vec![notion_row('1', "Personal row", vec![])],
            bodies: [(id('1'), "Private body".into())].into(),
        };
        let writer = FakeWriter::default();
        let user = user();
        let item = source_item("Items");
        let old = Uuid::from_u128(700);
        let private = Uuid::from_u128(701);
        let store = FakeStore::default();
        let previous = [WrittenObject::own(item.import_id, kind, old)];
        let progress = Progress::new(&store, &user, item.import_id, &previous);
        match kind {
            WrittenKind::BodiesFolder => {
                write_database(
                    &notion,
                    &writer,
                    &user,
                    &item,
                    Uuid::from_u128(42),
                    false,
                    &PeopleMap::new(),
                    &tokio::sync::RwLock::new(NotionLinks::default()),
                    &progress,
                    &Cancel::default(),
                    Some(private),
                )
                .await
                .unwrap();
                let docs = writer.documents.lock().unwrap();
                assert_eq!(docs.len(), 1);
                assert_eq!(docs[0].folder, Some(private));
            }
            WrittenKind::TasksFolder => {
                assert_eq!(
                    write_tasks(
                        &notion,
                        &writer,
                        &user,
                        &item,
                        Uuid::from_u128(42),
                        false,
                        &PeopleMap::new(),
                        &tokio::sync::RwLock::new(NotionLinks::default()),
                        &HashMap::new(),
                        &progress,
                        &Cancel::default(),
                        Some(private)
                    )
                    .await
                    .unwrap(),
                    private
                );
                assert_eq!(*writer.task_folders.lock().unwrap(), vec![Some(private)]);
            }
            _ => unreachable!(),
        }
        let mut reviewed_shared = item.clone();
        reviewed_shared.shared = true;
        match kind {
            WrittenKind::TasksFolder => {
                write_tasks(
                    &notion,
                    &writer,
                    &user,
                    &reviewed_shared,
                    Uuid::from_u128(42),
                    true,
                    &PeopleMap::new(),
                    &tokio::sync::RwLock::new(NotionLinks::default()),
                    &HashMap::new(),
                    &progress,
                    &Cancel::default(),
                    None,
                )
                .await
                .unwrap();
            }
            WrittenKind::BodiesFolder => {
                write_database(
                    &notion,
                    &writer,
                    &user,
                    &reviewed_shared,
                    Uuid::from_u128(42),
                    true,
                    &PeopleMap::new(),
                    &tokio::sync::RwLock::new(NotionLinks::default()),
                    &progress,
                    &Cancel::default(),
                    None,
                )
                .await
                .unwrap();
            }
            _ => unreachable!(),
        }
        let document = progress
            .get_for(
                if kind == WrittenKind::TasksFolder {
                    WrittenKind::Task
                } else {
                    WrittenKind::Body
                },
                id('1').as_str(),
            )
            .unwrap();
        let shares = writer.shares.lock().unwrap();
        assert!(
            shares
                .iter()
                .any(|share| matches!(share, SharedEntity::Document(id) if *id == document)),
            "the relocated output must follow its source's Shared re-review"
        );
        assert!(
            shares
                .iter()
                .all(|share| !matches!(share, SharedEntity::Folder(id) if *id == private)),
            "never share the mirror itself"
        );
        drop(shares);
        assert!(
            writer.folders.lock().unwrap().is_empty(),
            "the recorded shared folder is never reused or changed"
        );
    }
}

#[tokio::test]
async fn sharing_an_incomplete_source_reuses_only_that_sources_private_outputs() {
    use crate::domain::service::notion_workspace::write::write_tasks;
    for kind in [WrittenKind::BodiesFolder, WrittenKind::TasksFolder] {
        let notion = FakeNotion {
            views: Vec::new(),
            fetched: Mutex::new(0),
            queries: Mutex::new(0),
            scan_stop: None,
            paginated: false,
            source: NotionDataSource {
                id: id('e'),
                database_id: id('f'),
                title: "Items".into(),
                database_parent: NotionParent::Workspace,
                in_trash: false,
                properties: Vec::new(),
            },
            rows: vec![
                notion_row('1', "Earlier private row", vec![]),
                notion_row('2', "Remaining row", vec![]),
            ],
            bodies: [
                (id('1'), "Earlier body".into()),
                (id('2'), "Remaining body".into()),
            ]
            .into(),
        };
        let writer = FakeWriter::default();
        let user = user();
        let mut item = source_item("Items");
        item.shared = true;
        let own_folder = Uuid::from_u128(700);
        let unrelated_folder = Uuid::from_u128(800);
        // One row and the source's private destination survived an interruption.
        // The new review says Shared for this same source, including that row.
        let mut previous = vec![
            WrittenObject::own(item.import_id, kind, own_folder),
            WrittenObject::own(Uuid::from_u128(999), kind, unrelated_folder),
        ];
        match kind {
            WrittenKind::TasksFolder => previous.push(WrittenObject::for_row(
                item.import_id,
                WrittenKind::Task,
                &id('1'),
                Uuid::from_u128(600),
            )),
            WrittenKind::BodiesFolder => {
                for (kind, value) in [
                    (WrittenKind::Database, DATABASE),
                    (WrittenKind::Table, TABLE),
                    (WrittenKind::TitleColumn, TITLE_COLUMN),
                    (WrittenKind::Schema, DATABASE),
                    (WrittenKind::SchemaPlan, derived_id(DATABASE, "schema/[]")),
                ] {
                    previous.push(WrittenObject::own(item.import_id, kind, value));
                }
                previous.push(WrittenObject::for_row(
                    item.import_id,
                    WrittenKind::Row,
                    &id('1'),
                    Uuid::from_u128(699),
                ));
                previous.push(WrittenObject::for_row(
                    item.import_id,
                    WrittenKind::Body,
                    &id('1'),
                    Uuid::from_u128(600),
                ));
            }
            _ => unreachable!(),
        }
        let store = FakeStore {
            written: Mutex::new(previous.clone()),
            ..Default::default()
        };
        let progress = Progress::new(&store, &user, item.import_id, &previous);
        match kind {
            WrittenKind::TasksFolder => {
                assert_eq!(
                    write_tasks(
                        &notion,
                        &writer,
                        &user,
                        &item,
                        Uuid::from_u128(42),
                        true,
                        &PeopleMap::new(),
                        &tokio::sync::RwLock::new(NotionLinks::default()),
                        &HashMap::new(),
                        &progress,
                        &Cancel::default(),
                        None
                    )
                    .await
                    .unwrap(),
                    own_folder
                );
                assert_eq!(*writer.task_folders.lock().unwrap(), vec![Some(own_folder)]);
            }
            WrittenKind::BodiesFolder => {
                write_database(
                    &notion,
                    &writer,
                    &user,
                    &item,
                    Uuid::from_u128(42),
                    true,
                    &PeopleMap::new(),
                    &tokio::sync::RwLock::new(NotionLinks::default()),
                    &progress,
                    &Cancel::default(),
                    None,
                )
                .await
                .unwrap();
                let docs = writer.documents.lock().unwrap();
                assert_eq!(docs.len(), 1, "the earlier row body is reused");
                assert_eq!(docs[0].folder, Some(own_folder));
                assert_eq!(
                    *writer.databases.lock().unwrap(),
                    0,
                    "the same source database is reused"
                );
            }
            _ => unreachable!(),
        }
        let shares = writer.shares.lock().unwrap();
        assert!(shares.iter().any(|share| matches!(share, SharedEntity::Document(document) if *document == Uuid::from_u128(600))), "earlier rows can live outside the recorded folder after a personal relocation");
        assert!(
            shares.iter().any(
                |share| matches!(share, SharedEntity::Folder(folder) if *folder == own_folder)
            )
        );
        assert!(
            shares.iter().all(|share| match share {
                SharedEntity::Folder(folder) => *folder == own_folder,
                SharedEntity::Database(database) =>
                    kind == WrittenKind::BodiesFolder && *database == DATABASE,
                SharedEntity::Document(document) => *document == Uuid::from_u128(600),
            }),
            "unrelated private outputs and the shared parent must remain unchanged"
        );
        assert!(writer.folders.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn a_shared_retry_reapplies_only_the_assignee_to_a_marked_notion_task() {
    use crate::domain::service::notion_workspace::write::write_tasks;
    use import_notion::domain::macro_cells::Person;
    let person = id('a');
    let people: PeopleMap = [(
        person.clone(),
        Person {
            email: Some("assignee@example.com".into()),
            macro_user: None,
        },
    )]
    .into();
    let notion = FakeNotion {
        views: Vec::new(),
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Tasks".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![],
        },
        rows: vec![notion_row(
            '1',
            "Earlier personal task",
            vec![
                ("Owner", NotionValue::People(vec![person])),
                ("Stage", NotionValue::Option("Done".into())),
            ],
        )],
        bodies: Default::default(),
    };
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let mut item = source_item("Tasks");
    item.shared = true;
    item.task_fields.assignee = Some("Owner".into());
    item.task_fields.status = Some("Stage".into());
    let task = Uuid::from_u128(600);
    let known = [
        WrittenObject::for_row(item.import_id, WrittenKind::Task, &id('1'), task),
        omitted_assignee_notice(item.import_id, task),
    ];
    let progress = Progress::new(&store, &user, item.import_id, &known);
    write_tasks(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        true,
        &people,
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &HashMap::new(),
        &progress,
        &Cancel::default(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        *writer.reapplied_tasks.lock().unwrap(),
        vec![(
            task,
            "assignee@example.com".to_string(),
            ImportVisibility::Shared
        )]
    );
    assert!(
        writer.tasks.lock().unwrap().is_empty(),
        "replay must not create the task again"
    );
}

#[tokio::test]
async fn an_assignee_replay_failure_is_reported_even_when_other_rows_succeed() {
    use crate::domain::service::notion_workspace::write::write_tasks;
    use import_notion::domain::macro_cells::Person;
    let person = id('a');
    let people: PeopleMap = [(
        person.clone(),
        Person {
            email: Some("assignee@example.com".into()),
            macro_user: None,
        },
    )]
    .into();
    let notion = FakeNotion {
        views: Vec::new(),
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Tasks".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![],
        },
        rows: vec![notion_row(
            '1',
            "Earlier personal task",
            vec![
                ("Owner", NotionValue::People(vec![person])),
                ("Stage", NotionValue::Option("Done".into())),
            ],
        )],
        bodies: Default::default(),
    };
    let mut notion = notion;
    notion.rows.push(notion_row('2', "Unassigned task", vec![]));
    let writer = FakeWriter {
        reject_assignee_replay: true,
        ..Default::default()
    };
    let store = FakeStore::default();
    let user = user();
    let mut item = source_item("Tasks");
    item.shared = true;
    item.task_fields.assignee = Some("Owner".into());
    item.task_fields.status = Some("Stage".into());
    let task = Uuid::from_u128(600);
    let known = [
        WrittenObject::for_row(item.import_id, WrittenKind::Task, &id('1'), task),
        omitted_assignee_notice(item.import_id, task),
    ];
    let progress = Progress::new(&store, &user, item.import_id, &known);
    let error = write_tasks(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        true,
        &people,
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &HashMap::new(),
        &progress,
        &Cancel::default(),
        None,
    )
    .await
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("assignees could not be reapplied")
    );
    assert_eq!(
        writer.tasks.lock().unwrap().len(),
        1,
        "the other row succeeded"
    );
}

#[tokio::test]
async fn a_shared_retry_preserves_assignments_without_an_omission_notice() {
    use crate::domain::service::notion_workspace::write::write_tasks;
    use import_notion::domain::macro_cells::Person;
    let person = id('a');
    let people: PeopleMap = [(
        person.clone(),
        Person {
            email: Some("assignee@example.com".into()),
            macro_user: None,
        },
    )]
    .into();
    let notion = FakeNotion {
        views: Vec::new(),
        fetched: Mutex::new(0),
        queries: Mutex::new(0),
        scan_stop: None,
        paginated: false,
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Tasks".into(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![],
        },
        rows: vec![notion_row(
            '1',
            "Earlier personal task",
            vec![
                ("Owner", NotionValue::People(vec![person])),
                ("Stage", NotionValue::Option("Done".into())),
            ],
        )],
        bodies: Default::default(),
    };
    let writer = FakeWriter::default();
    let store = FakeStore::default();
    let user = user();
    let mut item = source_item("Tasks");
    item.shared = true;
    item.task_fields.assignee = Some("Owner".into());
    item.task_fields.status = Some("Stage".into());
    let task = Uuid::from_u128(600);
    let known = [
        WrittenObject::for_row(item.import_id, WrittenKind::Task, &id('1'), task),
        omitted_assignee_notice(Uuid::from_u128(999), task),
    ];
    let progress = Progress::new(&store, &user, item.import_id, &known);
    write_tasks(
        &notion,
        &writer,
        &user,
        &item,
        Uuid::from_u128(42),
        true,
        &people,
        &tokio::sync::RwLock::new(NotionLinks::default()),
        &HashMap::new(),
        &progress,
        &Cancel::default(),
        None,
    )
    .await
    .unwrap();
    assert!(
        writer.reapplied_tasks.lock().unwrap().is_empty(),
        "a Shared retry must preserve an existing assignment without an omission notice"
    );
    assert!(
        writer.tasks.lock().unwrap().is_empty(),
        "replay must not create the task again"
    );
}

fn omitted_assignee_notice(import_id: Uuid, task: Uuid) -> WrittenObject {
    WrittenObject {
        import_id,
        kind: WrittenKind::TaskNotice,
        object: serde_json::to_string(&crate::domain::models::TaskImportNotice {
            task_id: task,
            reason: crate::domain::models::TaskImportNoticeReason::PersonalAssigneeOmitted,
        })
        .unwrap(),
        macro_id: task,
    }
}
