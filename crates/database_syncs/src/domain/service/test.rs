mod fakes;

use std::collections::BTreeMap;

use call::domain::imports::ImportedCallRecord;
use call::domain::records::ExternalCallId;
use chrono::{TimeZone, Utc};
use import_notion::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionParent, NotionPropertyKind, NotionPropertySchema,
    NotionUser, NotionValue,
};
use models_databases::{
    CellValue, CellWrite, ColumnId, ColumnKind, EntityKind, EntityRef, RowId, TableId,
};
use uuid::Uuid;

use self::fakes::{FakeAccess, FakeGranola, FakeNotion, FakeRepo, FakeTables, FakeTeam, REFUSED};
use super::*;
use crate::domain::columns::TableColumn;
use crate::domain::models::{
    DetachReason, DetachedColumn, GranolaField, SyncFailure, SyncField, SyncStatus, SyncedColumn,
};
use crate::domain::plan::RowMapping;
use crate::domain::ports::SyncTable;

const ALICE: &str = "macro|alice@example.com";
const BOB: &str = "macro|bob@example.com";
const DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(1));
const STARTER: TableId = TableId::from_uuid(Uuid::from_u128(2));
const SYNC: SyncId = Uuid::from_u128(3);
const KICKOFF_CALL: Uuid = Uuid::from_u128(40);
const REVIEW_CALL: Uuid = Uuid::from_u128(41);
const NOTION_SOURCE: &str = "0123456789abcdef0123456789abcdef";
const TASK_ONE: &str = "11111111111111111111111111111111";
const TASK_TWO: &str = "22222222222222222222222222222222";

type Service =
    DatabaseSyncsServiceImpl<FakeRepo, FakeTables, FakeAccess, FakeGranola, FakeNotion, FakeTeam>;

fn alice() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(ALICE).unwrap()
}

fn alice_edits(database: DatabaseId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        alice(),
        &database.to_string(),
        EntityType::Database,
    )
}

fn kickoff() -> ImportedCallRecord {
    ImportedCallRecord {
        id: KICKOFF_CALL,
        title: Some("Kickoff".to_string()),
        started_at: Some(Utc.with_ymd_and_hms(2026, 11, 2, 15, 0, 0).unwrap()),
        ended_at: None,
        attendees: vec!["Alice".to_string(), "Bob".to_string()],
        external_id: ExternalCallId("note_kickoff".to_string()),
        external_url: Some("https://notes.granola.ai/d/kickoff".to_string()),
        summary: Some("Agreed on the plan".to_string()),
        external_updated_at: None,
    }
}

fn review() -> ImportedCallRecord {
    ImportedCallRecord {
        id: REVIEW_CALL,
        title: Some("Review".to_string()),
        started_at: None,
        ended_at: None,
        attendees: vec![],
        external_id: ExternalCallId("note_review".to_string()),
        external_url: None,
        summary: None,
        external_updated_at: None,
    }
}

/// A service over one database Alice can edit, holding a starter table,
/// with Granola connected.
fn service() -> (
    Service,
    FakeRepo,
    FakeTables,
    FakeAccess,
    FakeGranola,
    FakeNotion,
) {
    let repository = FakeRepo::default();
    let tables = FakeTables::default();
    tables.databases.lock().unwrap().insert(
        DATABASE,
        vec![SyncTable {
            id: STARTER,
            name: "Granola meetings".to_string(),
            columns: vec![],
        }],
    );
    let access = FakeAccess::default();
    access
        .editors
        .lock()
        .unwrap()
        .push((ALICE.to_string(), DATABASE));
    let granola = FakeGranola {
        connected: true,
        ..FakeGranola::default()
    };
    let notion = FakeNotion {
        connected: true,
        ..FakeNotion::default()
    };
    let team = FakeTeam {
        members: vec![alice(), MacroUserIdStr::parse_from_str(BOB).unwrap()],
    };
    (
        DatabaseSyncsServiceImpl::new(
            repository.clone(),
            tables.clone(),
            access.clone(),
            granola.clone(),
            notion.clone(),
            team,
        ),
        repository,
        tables,
        access,
        granola,
        notion,
    )
}

fn column_of(sync: &DatabaseSync, field: GranolaField) -> ColumnId {
    sync.columns
        .iter()
        .find(|column| column.field == SyncField::Granola { field })
        .unwrap()
        .column
}

#[tokio::test]
async fn a_granola_table_mirrors_the_meetings_as_they_change() {
    let (service, repository, tables, _, granola, _) = service();
    granola
        .meetings
        .lock()
        .unwrap()
        .extend([kickoff(), review()]);

    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();
    let table = sync.table_id;
    let schema = tables.databases.lock().unwrap()[&DATABASE].clone();
    assert_eq!(
        schema
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Granola meetings", "Granola meetings 2"]
    );
    assert_eq!(
        schema[1]
            .columns
            .iter()
            .map(|column| (column.name.as_str(), column.kind))
            .collect::<Vec<_>>(),
        vec![
            ("Title", Some(ColumnKind::Text)),
            ("Date", Some(ColumnKind::Date)),
            ("Attendees", Some(ColumnKind::Text)),
            ("Summary", Some(ColumnKind::Text)),
            ("Granola link", Some(ColumnKind::Link)),
            (
                "Call",
                Some(ColumnKind::Entity {
                    target: EntityKind::CallRecord,
                    multi: false
                })
            ),
        ]
    );

    assert!(service.run_due().await.unwrap());
    assert!(!service.run_due().await.unwrap());

    let rows = tables.table_rows(table);
    let kickoff_row = repository
        .rows
        .lock()
        .unwrap()
        .iter()
        .find(|(_, mapping)| mapping.external_id == "note_kickoff")
        .unwrap()
        .1
        .row_id;
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[&kickoff_row],
        vec![
            CellWrite {
                column: column_of(&sync, GranolaField::Title),
                value: CellValue::Text("Kickoff".to_string()),
            },
            CellWrite {
                column: column_of(&sync, GranolaField::Date),
                value: CellValue::Date(Utc.with_ymd_and_hms(2026, 11, 2, 15, 0, 0).unwrap()),
            },
            CellWrite {
                column: column_of(&sync, GranolaField::Attendees),
                value: CellValue::Text("Alice, Bob".to_string()),
            },
            CellWrite {
                column: column_of(&sync, GranolaField::Summary),
                value: CellValue::Text("Agreed on the plan".to_string()),
            },
            CellWrite {
                column: column_of(&sync, GranolaField::Link),
                value: CellValue::Link(vec!["https://notes.granola.ai/d/kickoff".to_string()]),
            },
            CellWrite {
                column: column_of(&sync, GranolaField::Call),
                value: CellValue::Entities(vec![EntityRef {
                    entity_type: EntityKind::CallRecord,
                    entity_id: KICKOFF_CALL.to_string(),
                }]),
            },
        ]
    );

    {
        let mut meetings = granola.meetings.lock().unwrap();
        meetings.retain(|meeting| meeting.id == KICKOFF_CALL);
        meetings[0].title = Some("Kickoff, renamed".to_string());
        meetings[0].summary = None;
    }
    service
        .source_changed(&alice(), SourceKind::GranolaMeetings)
        .await
        .unwrap();
    assert!(service.run_due().await.unwrap());

    let rows = tables.table_rows(table);
    assert_eq!(rows.keys().copied().collect::<Vec<_>>(), vec![kickoff_row]);
    assert!(rows[&kickoff_row].contains(&CellWrite {
        column: column_of(&sync, GranolaField::Title),
        value: CellValue::Text("Kickoff, renamed".to_string()),
    }));
    assert!(
        !rows[&kickoff_row]
            .iter()
            .any(|cell| cell.column == column_of(&sync, GranolaField::Summary))
    );
    assert_eq!(
        repository.syncs.lock().unwrap()[0].status,
        SyncStatus::Synced
    );
}

#[tokio::test]
async fn a_retried_create_answers_the_first_attempts_sync() {
    let (service, repository, tables, _, _, _) = service();
    let create = || NewSync {
        id: SYNC,
        source: SyncSource::GranolaMeetings,
    };

    let first = service
        .create_sync(alice_edits(DATABASE), create())
        .await
        .unwrap();
    let second = service
        .create_sync(alice_edits(DATABASE), create())
        .await
        .unwrap();
    let other = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::NotionDataSource {
                    data_source_id: NotionId::parse(NOTION_SOURCE).unwrap(),
                },
            },
        )
        .await;

    assert_eq!(first, second);
    assert_eq!(tables.batches.lock().unwrap().len(), 1);
    assert_eq!(repository.syncs.lock().unwrap().len(), 1);
    assert!(matches!(other, Err(DatabaseSyncError::IdTaken)));
}

#[tokio::test]
async fn a_creator_who_lost_access_stops_the_sync_without_writing() {
    let (service, repository, tables, access, granola, _) = service();
    granola.meetings.lock().unwrap().push(kickoff());
    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();
    access.editors.lock().unwrap().clear();

    assert!(service.run_due().await.unwrap());

    assert!(tables.table_rows(sync.table_id).is_empty());
    assert_eq!(
        repository.syncs.lock().unwrap()[0].status,
        SyncStatus::Failed {
            failure: SyncFailure::CreatorLostAccess
        }
    );
    assert_eq!(
        repository.finished.lock().unwrap()[0].next_run_in,
        std::time::Duration::from_secs(15 * 60)
    );
}

#[tokio::test]
async fn a_deleted_column_stops_syncing_while_the_others_keep_going() {
    let (service, repository, tables, _, granola, _) = service();
    granola.meetings.lock().unwrap().push(kickoff());
    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();
    let summary = column_of(&sync, GranolaField::Summary);
    tables.databases.lock().unwrap().get_mut(&DATABASE).unwrap()[1]
        .columns
        .retain(|column| column.id != summary);

    assert!(service.run_due().await.unwrap());
    service.sync_now(alice_edits(DATABASE), SYNC).await.unwrap();
    assert!(service.run_due().await.unwrap());

    let stored = repository.syncs.lock().unwrap()[0].clone();
    assert_eq!(
        stored.detached_columns,
        vec![DetachedColumn {
            field: SyncField::Granola {
                field: GranolaField::Summary,
            },
            column: summary,
            reason: DetachReason::Deleted,
        }]
    );
    assert_eq!(stored.columns.len(), 5);
    let schema = tables.databases.lock().unwrap()[&DATABASE][1].clone();
    assert_eq!(schema.columns.len(), 5);
    let rows = tables.table_rows(sync.table_id);
    assert_eq!(rows.len(), 1);
    assert!(
        rows.values()
            .next()
            .unwrap()
            .iter()
            .all(|cell| cell.column != summary)
    );
}

#[tokio::test]
async fn an_unfinished_insert_is_resumed_under_its_reserved_ids_without_duplicates() {
    let (service, repository, tables, _, granola, _) = service();
    granola
        .meetings
        .lock()
        .unwrap()
        .extend([kickoff(), review()]);
    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();
    // A run reserved both ids, and only the kickoff's insert committed.
    let kickoff_row = RowId::from_uuid(Uuid::from_u128(900));
    let review_row = RowId::from_uuid(Uuid::from_u128(901));
    repository.rows.lock().unwrap().extend([
        (
            SYNC,
            RowMapping {
                external_id: "note_kickoff".to_string(),
                row_id: kickoff_row,
                fingerprint: None,
            },
        ),
        (
            SYNC,
            RowMapping {
                external_id: "note_review".to_string(),
                row_id: review_row,
                fingerprint: None,
            },
        ),
    ]);
    tables.rows.lock().unwrap().insert(
        kickoff_row,
        (
            sync.table_id,
            vec![CellWrite {
                column: column_of(&sync, GranolaField::Title),
                value: CellValue::Text("Kickoff".to_string()),
            }],
        ),
    );

    assert!(service.run_due().await.unwrap());

    let mut rows: Vec<RowId> = tables.table_rows(sync.table_id).into_keys().collect();
    rows.sort();
    assert_eq!(rows, vec![kickoff_row, review_row]);
    assert!(
        repository
            .rows
            .lock()
            .unwrap()
            .iter()
            .all(|(_, mapping)| mapping.fingerprint.is_some())
    );
}

#[tokio::test]
async fn a_refused_row_is_left_for_the_next_run_and_the_rest_are_written() {
    let (service, repository, tables, _, granola, _) = service();
    let mut refused = review();
    refused.title = Some(REFUSED.to_string());
    granola
        .meetings
        .lock()
        .unwrap()
        .extend([kickoff(), refused]);
    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();

    assert!(service.run_due().await.unwrap());

    assert_eq!(tables.table_rows(sync.table_id).len(), 1);
    assert_eq!(
        repository
            .rows
            .lock()
            .unwrap()
            .iter()
            .map(|(_, mapping)| mapping.external_id.as_str())
            .collect::<Vec<_>>(),
        vec!["note_kickoff"]
    );
    assert_eq!(
        repository.syncs.lock().unwrap()[0].status,
        SyncStatus::Synced
    );
}

#[tokio::test]
async fn a_batch_whose_every_row_is_refused_stops_retrying_after_a_few_refusals() {
    let (service, repository, tables, _, granola, _) = service();
    granola
        .meetings
        .lock()
        .unwrap()
        .extend((0..40u128).map(|n| ImportedCallRecord {
            id: Uuid::from_u128(1_000 + n),
            title: Some(REFUSED.to_string()),
            external_id: ExternalCallId(format!("note_{n}")),
            ..review()
        }));
    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();

    assert!(service.run_due().await.unwrap());

    assert_eq!(*tables.refusals.lock().unwrap(), 16);
    assert!(tables.table_rows(sync.table_id).is_empty());
    assert!(repository.rows.lock().unwrap().is_empty());
    assert_eq!(
        repository.syncs.lock().unwrap()[0].status,
        SyncStatus::Synced
    );
}

fn notion_page(id: &str, title: &str, status: &str, owner: &str) -> NotionPage {
    NotionPage {
        id: NotionId::parse(id).unwrap(),
        title: title.to_string(),
        url: format!("https://www.notion.so/{id}"),
        parent: NotionParent::Other,
        last_edited: Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::from([
            (
                "Status".to_string(),
                NotionValue::Option(status.to_string()),
            ),
            (
                "Owner".to_string(),
                NotionValue::People(vec![NotionId::parse(owner).unwrap()]),
            ),
        ]),
    }
}

fn tasks_source(properties: Vec<NotionPropertySchema>) -> NotionDataSource {
    NotionDataSource {
        id: NotionId::parse(NOTION_SOURCE).unwrap(),
        database_id: NotionId::parse(NOTION_SOURCE).unwrap(),
        title: "Tasks".to_string(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties,
    }
}

#[tokio::test]
async fn a_notion_table_follows_new_properties_and_never_deletes_on_a_cut_off_read() {
    let (service, repository, tables, _, _, notion) = service();
    let bob_notion = "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
    let title = NotionPropertySchema {
        id: "title".to_string(),
        name: "Name".to_string(),
        kind: NotionPropertyKind::Title,
    };
    let status = NotionPropertySchema {
        id: "st".to_string(),
        name: "Status".to_string(),
        kind: NotionPropertyKind::Status {
            options: vec![import_notion::domain::model::NotionOption {
                id: "o1".to_string(),
                name: "Doing".to_string(),
                color: "blue".to_string(),
            }],
        },
    };
    let owner = NotionPropertySchema {
        id: "ow".to_string(),
        name: "Owner".to_string(),
        kind: NotionPropertyKind::People,
    };
    *notion.source.lock().unwrap() = Some(tasks_source(vec![title.clone(), status.clone()]));
    notion.rows.lock().unwrap().extend([
        notion_page(TASK_ONE, "Write the plan", "Doing", bob_notion),
        notion_page(TASK_TWO, "Ship it", "Doing", bob_notion),
    ]);
    notion.users.lock().unwrap().push(NotionUser {
        id: NotionId::parse(bob_notion).unwrap(),
        name: Some("Bob".to_string()),
        email: Some("Bob@Example.com".to_string()),
    });
    let source = SyncSource::NotionDataSource {
        data_source_id: NotionId::parse(NOTION_SOURCE).unwrap(),
    };

    let sync = service
        .create_sync(alice_edits(DATABASE), NewSync { id: SYNC, source })
        .await
        .unwrap();
    assert!(service.run_due().await.unwrap());
    assert_eq!(tables.table_rows(sync.table_id).len(), 2);

    // Notion gains an owner property, loses a row, and cuts the read off.
    *notion.source.lock().unwrap() = Some(tasks_source(vec![title, status, owner]));
    notion.rows.lock().unwrap().truncate(1);
    *notion.truncated.lock().unwrap() = true;
    service.sync_now(alice_edits(DATABASE), SYNC).await.unwrap();
    assert!(service.run_due().await.unwrap());

    let table = tables.databases.lock().unwrap()[&DATABASE][1].clone();
    assert_eq!(
        table
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Name", "Status", "Owner"]
    );
    let owner_column = table.columns[2].id;
    let rows = tables.table_rows(sync.table_id);
    assert_eq!(rows.len(), 2);
    let task_one_row = repository
        .rows
        .lock()
        .unwrap()
        .iter()
        .find(|(_, mapping)| mapping.external_id == TASK_ONE)
        .unwrap()
        .1
        .row_id;
    assert!(rows[&task_one_row].contains(&CellWrite {
        column: owner_column,
        value: CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::User,
            entity_id: BOB.to_string(),
        }]),
    }));

    // A complete read removes the row Notion lost.
    *notion.truncated.lock().unwrap() = false;
    service.sync_now(alice_edits(DATABASE), SYNC).await.unwrap();
    assert!(service.run_due().await.unwrap());
    assert_eq!(
        tables
            .table_rows(sync.table_id)
            .into_keys()
            .collect::<Vec<_>>(),
        vec![task_one_row]
    );
}

#[tokio::test]
async fn a_select_option_added_in_macro_under_the_same_label_is_reused() {
    let (service, _, tables, _, _, notion) = service();
    let status = NotionPropertySchema {
        id: "st".to_string(),
        name: "Status".to_string(),
        kind: NotionPropertyKind::Select { options: vec![] },
    };
    *notion.source.lock().unwrap() = Some(tasks_source(vec![status.clone()]));
    let sync = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::NotionDataSource {
                    data_source_id: NotionId::parse(NOTION_SOURCE).unwrap(),
                },
            },
        )
        .await
        .unwrap();
    let column = sync.columns[0].column;
    let macro_done = models_databases::OptionId::from_uuid(Uuid::from_u128(700));
    tables.databases.lock().unwrap().get_mut(&DATABASE).unwrap()[1].columns[0]
        .options
        .push((macro_done, "done".to_string()));
    *notion.source.lock().unwrap() = Some(tasks_source(vec![NotionPropertySchema {
        kind: NotionPropertyKind::Select {
            options: vec![import_notion::domain::model::NotionOption {
                id: "o1".to_string(),
                name: "Done".to_string(),
                color: "green".to_string(),
            }],
        },
        ..status
    }]));
    let mut page = notion_page(TASK_ONE, "", "Done", TASK_TWO);
    page.properties.remove("Owner");
    notion.rows.lock().unwrap().push(page);

    assert!(service.run_due().await.unwrap());

    let table = tables.databases.lock().unwrap()[&DATABASE][1].clone();
    assert_eq!(
        table.columns,
        vec![TableColumn {
            id: column,
            name: "Status".to_string(),
            kind: Some(ColumnKind::Select { multi: false }),
            options: vec![(macro_done, "done".to_string())],
        }]
    );
    assert_eq!(
        tables
            .table_rows(sync.table_id)
            .into_values()
            .collect::<Vec<_>>(),
        vec![vec![CellWrite {
            column,
            value: CellValue::Options(vec![models_databases::OptionRef::Id(macro_done)]),
        }]]
    );
}

#[tokio::test]
async fn a_synced_database_is_one_synced_table_named_after_its_source() {
    let (service, repository, tables, access, _, notion) = service();
    *notion.source.lock().unwrap() = Some(tasks_source(vec![NotionPropertySchema {
        id: "title".to_string(),
        name: "Name".to_string(),
        kind: NotionPropertyKind::Title,
    }]));
    access.editors.lock().unwrap().push((
        ALICE.to_string(),
        DatabaseId::from_uuid(Uuid::from_u128(500)),
    ));

    let sync = service
        .create_synced_database(
            &alice(),
            NewSync {
                id: SYNC,
                source: SyncSource::NotionDataSource {
                    data_source_id: NotionId::parse(NOTION_SOURCE).unwrap(),
                },
            },
        )
        .await
        .unwrap();

    assert_eq!(
        *tables.created_databases.lock().unwrap(),
        vec![(ALICE.to_string(), "Tasks".to_string())]
    );
    let database = tables.databases.lock().unwrap()[&sync.database_id].clone();
    assert_eq!(
        database
            .iter()
            .map(|table| (table.id, table.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(sync.table_id, "Tasks")]
    );
    assert_eq!(
        sync.columns,
        vec![SyncedColumn {
            field: SyncField::Notion {
                property_id: "title".to_string(),
            },
            column: database[0].columns[0].id,
        }]
    );
    assert_eq!(repository.syncs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_source_that_is_not_connected_creates_nothing() {
    let (mut service, repository, tables, _, _, _) = service();
    service.notion = FakeNotion::default();

    let created = service
        .create_sync(
            alice_edits(DATABASE),
            NewSync {
                id: SYNC,
                source: SyncSource::NotionDataSource {
                    data_source_id: NotionId::parse(NOTION_SOURCE).unwrap(),
                },
            },
        )
        .await;
    let sources = service.sources(&alice()).await.unwrap();

    assert!(matches!(
        created,
        Err(DatabaseSyncError::SourceDisconnected)
    ));
    assert!(tables.batches.lock().unwrap().is_empty());
    assert!(repository.syncs.lock().unwrap().is_empty());
    assert_eq!(
        sources,
        AvailableSources {
            granola: GranolaAvailability { connected: true },
            notion: NotionAvailability {
                connected: false,
                data_sources: vec![],
            },
        }
    );
}

#[tokio::test]
async fn sources_list_the_notion_data_sources_the_connection_reads() {
    let (service, _, _, _, _, notion) = service();
    *notion.source.lock().unwrap() = Some(tasks_source(vec![]));

    let sources = service.sources(&alice()).await.unwrap();

    assert_eq!(
        sources.notion,
        NotionAvailability {
            connected: true,
            data_sources: vec![NotionDataSourceSummary {
                id: NotionId::parse(NOTION_SOURCE).unwrap(),
                title: "Tasks".to_string(),
            }],
        }
    );
}
