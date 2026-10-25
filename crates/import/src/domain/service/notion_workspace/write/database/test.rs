use std::collections::BTreeMap;
use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use import_notion::domain::model::{
    NotionOption, NotionParent, NotionUser, PageMarkdown, Paged, SearchHit, SearchObject,
};
use import_notion::domain::ports::NotionError;
use macro_user_id::cowlike::CowLike;

use super::*;
use crate::domain::models::{ImportKind, NotionDecision, NotionTaskFields};
use crate::domain::ports::{ImportedTaskProperties, NotionPageLink, TeamMember};

fn id(hex: char) -> NotionId {
    NotionId::parse(&hex.to_string().repeat(32)).unwrap()
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@acme.test")
        .unwrap()
        .into_owned()
}

fn source_item(title: &str) -> WriteItem {
    WriteItem {
        import_id: Uuid::from_u128(1),
        parent: None,
        notion_id: id('e'),
        kind: ImportKind::DataSource,
        title: title.to_string(),
        decision: NotionDecision::Copy,
        task_fields: NotionTaskFields::default(),
        shared: false,
        shareable: true,
        already_imported: false,
    }
}

/// What earlier attempts recorded, kept the way the ledger keeps it: the
/// first record of an object wins.
#[derive(Default)]
struct FakeStore(Mutex<Vec<WrittenObject>>);

impl WrittenObjects for FakeStore {
    async fn written(
        &self,
        _user: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> crate::domain::ports::Result<Vec<WrittenObject>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|object| import_ids.contains(&object.import_id))
            .cloned()
            .collect())
    }

    async fn record_written(
        &self,
        _user: &MacroUserIdStr<'static>,
        objects: &[WrittenObject],
    ) -> crate::domain::ports::Result<Vec<WrittenObject>> {
        let mut stored = self.0.lock().unwrap();
        Ok(objects
            .iter()
            .map(|object| {
                let existing = stored.iter().find(|known| {
                    known.import_id == object.import_id
                        && known.kind == object.kind
                        && known.object == object.object
                });
                match existing {
                    Some(known) => known.clone(),
                    None => {
                        stored.push(object.clone());
                        object.clone()
                    }
                }
            })
            .collect())
    }
}

/// A Notion workspace holding one data source with two rows.
struct FakeNotion {
    source: NotionDataSource,
    rows: Vec<NotionPage>,
    bodies: HashMap<NotionId, String>,
    /// How many page bodies were read.
    fetched: Mutex<usize>,
}

impl NotionApi for FakeNotion {
    async fn search(
        &self,
        _object: SearchObject,
        _cursor: Option<String>,
    ) -> std::result::Result<Paged<SearchHit>, NotionError> {
        unimplemented!("writing never searches")
    }

    async fn page(&self, _id: &NotionId) -> std::result::Result<NotionPage, NotionError> {
        unimplemented!("rows come from the query")
    }

    async fn page_markdown(&self, id: &NotionId) -> std::result::Result<PageMarkdown, NotionError> {
        *self.fetched.lock().unwrap() += 1;
        Ok(PageMarkdown {
            markdown: self.bodies.get(id).cloned().unwrap_or_default(),
            unknown_block_ids: Vec::new(),
        })
    }

    async fn data_source(
        &self,
        _id: &NotionId,
    ) -> std::result::Result<NotionDataSource, NotionError> {
        Ok(self.source.clone())
    }

    async fn database_sources(
        &self,
        _database: &NotionId,
    ) -> std::result::Result<Vec<NotionId>, NotionError> {
        unimplemented!("writing never expands databases")
    }

    async fn query_data_source(
        &self,
        _id: &NotionId,
        _cursor: Option<String>,
    ) -> std::result::Result<Paged<NotionPage>, NotionError> {
        Ok(Paged {
            results: self.rows.clone(),
            next_cursor: None,
        })
    }

    async fn users(
        &self,
        _cursor: Option<String>,
    ) -> std::result::Result<Paged<NotionUser>, NotionError> {
        unimplemented!("people come in as a map")
    }
}

/// A document the import asked for.
struct WrittenDocument {
    id: Uuid,
    name: String,
    markdown: String,
    links: NotionLinks,
}

/// Records what the import asks Macro to create. `fail_at_batch` makes that
/// database write (counting from 0) fail, the way a crash part way would
/// leave it.
#[derive(Default)]
struct FakeWriter {
    databases: Mutex<usize>,
    folders: Mutex<Vec<(String, Option<Uuid>)>>,
    documents: Mutex<Vec<WrittenDocument>>,
    batches: Mutex<Vec<Vec<DatabaseOp>>>,
    next_row: Mutex<u128>,
    fail_at_batch: Mutex<Option<usize>>,
    shares: Mutex<Vec<SharedEntity>>,
}

const DATABASE: Uuid = Uuid::from_u128(500);
const TABLE: Uuid = Uuid::from_u128(501);
const TITLE_COLUMN: Uuid = Uuid::from_u128(502);

impl WorkspaceWriter for FakeWriter {
    async fn create_folder(
        &self,
        _user: &MacroUserIdStr<'static>,
        name: &str,
        parent: Option<Uuid>,
    ) -> anyhow::Result<Uuid> {
        let mut folders = self.folders.lock().unwrap();
        folders.push((name.to_string(), parent));
        Ok(Uuid::from_u128(900 + folders.len() as u128))
    }

    async fn folder_exists(
        &self,
        _user: &MacroUserIdStr<'static>,
        _folder: Uuid,
    ) -> anyhow::Result<bool> {
        Ok(true)
    }

    async fn share_with_team(
        &self,
        _user: &MacroUserIdStr<'static>,
        entity: SharedEntity,
    ) -> anyhow::Result<()> {
        self.shares.lock().unwrap().push(entity);
        Ok(())
    }

    async fn create_document(
        &self,
        _user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        links: &NotionLinks,
        _properties: &ImportedDocumentProperties,
        _folder: Option<Uuid>,
    ) -> anyhow::Result<String> {
        let mut documents = self.documents.lock().unwrap();
        // Like Macro: a document id already in use is the earlier attempt's.
        if !documents.iter().any(|document| document.id == id) {
            documents.push(WrittenDocument {
                id,
                name: name.to_string(),
                markdown: markdown.to_string(),
                links: links.clone(),
            });
        }
        Ok(id.to_string())
    }

    async fn create_task(
        &self,
        _user: &MacroUserIdStr<'static>,
        _id: Uuid,
        _name: &str,
        _markdown: &str,
        _links: &NotionLinks,
        _properties: &ImportedTaskProperties,
        _folder: Option<Uuid>,
    ) -> anyhow::Result<String> {
        unimplemented!("a copied database writes no tasks")
    }

    async fn create_database(
        &self,
        _user: &MacroUserIdStr<'static>,
        _name: &str,
    ) -> anyhow::Result<NewDatabase> {
        *self.databases.lock().unwrap() += 1;
        Ok(NewDatabase {
            database_id: DATABASE,
            table: TableId::from_uuid(TABLE),
            title_column: ColumnId::from_uuid(TITLE_COLUMN),
        })
    }

    async fn apply_database_ops(
        &self,
        _user: &MacroUserIdStr<'static>,
        _database_id: Uuid,
        ops: Vec<DatabaseOp>,
    ) -> anyhow::Result<Vec<OpResult>> {
        let mut batches = self.batches.lock().unwrap();
        if *self.fail_at_batch.lock().unwrap() == Some(batches.len()) {
            anyhow::bail!("the process stopped");
        }
        let mut next_row = self.next_row.lock().unwrap();
        let results = ops
            .iter()
            .filter_map(|op| match op {
                DatabaseOp::Rows {
                    change: RowsChange::Insert { rows },
                    ..
                } => Some(OpResult::Rows {
                    table: TableId::from_uuid(TABLE),
                    table_version: models_databases::TableVersion(1),
                    change: RowsResult::Inserted {
                        rows: rows
                            .iter()
                            .map(|_| {
                                *next_row += 1;
                                RowId::from_uuid(Uuid::from_u128(699 + *next_row))
                            })
                            .collect(),
                    },
                }),
                _ => None,
            })
            .collect();
        batches.push(ops);
        Ok(results)
    }

    async fn team_members(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<TeamMember>> {
        Ok(Vec::new())
    }
}

fn notion_row(hex: char, title: &str, properties: Vec<(&str, NotionValue)>) -> NotionPage {
    NotionPage {
        id: id(hex),
        title: title.to_string(),
        url: id(hex).url(),
        parent: NotionParent::DataSource {
            data_source: id('e'),
            database: id('f'),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
        in_trash: false,
        properties: properties
            .into_iter()
            .map(|(name, value)| (name.to_string(), value))
            .collect::<BTreeMap<_, _>>(),
    }
}

#[tokio::test]
async fn a_data_source_becomes_a_database_with_typed_columns_rows_bodies_and_pending_relations() {
    let notion = FakeNotion {
        fetched: Mutex::new(0),
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Bugs".to_string(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: vec![
                NotionPropertySchema {
                    id: "title".to_string(),
                    name: "Bug".to_string(),
                    kind: NotionPropertyKind::Title,
                },
                NotionPropertySchema {
                    id: "sev".to_string(),
                    name: "Severity".to_string(),
                    kind: NotionPropertyKind::Select {
                        options: vec![NotionOption {
                            id: "o1".to_string(),
                            name: "High".to_string(),
                            color: "red".to_string(),
                        }],
                    },
                },
                NotionPropertySchema {
                    id: "proj".to_string(),
                    name: "Project".to_string(),
                    kind: NotionPropertyKind::Relation {
                        data_source_id: Some(id('9')),
                    },
                },
            ],
        },
        rows: vec![
            notion_row(
                '1',
                "Login fails",
                vec![
                    ("Severity", NotionValue::Option("High".to_string())),
                    ("Project", NotionValue::Relation(vec![id('8')])),
                ],
            ),
            notion_row('2', "Typo on pricing", vec![]),
        ],
        bodies: [(id('1'), "Steps to reproduce:\n\n1. Sign in".to_string())]
            .into_iter()
            .collect(),
    };
    let writer = FakeWriter::default();
    let folder = Uuid::from_u128(42);
    let links = NotionLinks {
        pages: [(
            id('7'),
            NotionPageLink {
                document_id: Uuid::from_u128(70),
                name: "Roadmap".to_string(),
            },
        )]
        .into(),
        users: HashMap::new(),
    };
    let source_item = source_item("Bugs");
    let store = FakeStore::default();
    let user = user();
    let progress = Progress::new(&store, &user, source_item.import_id, &[]);

    let written = write_database(
        &notion,
        &writer,
        &user,
        &source_item,
        folder,
        false,
        &PeopleMap::new(),
        &links,
        &progress,
        &Cancel::default(),
    )
    .await
    .unwrap();

    let batches = writer.batches.lock().unwrap();
    // Schema first: rename the starter table and title and add the select;
    // the relation waits, and the Page column comes once a row has content.
    let schema = &batches[0];
    assert!(matches!(
        &schema[0],
        DatabaseOp::Table { change: TableChange::Rename { name, .. }, .. } if name == "Bugs"
    ));
    assert!(matches!(
        &schema[1],
        DatabaseOp::Column { change: ColumnChange::Rename { name, .. }, .. } if name == "Bug"
    ));
    let created: Vec<(String, ColumnKind)> = schema
        .iter()
        .filter_map(|op| match op {
            DatabaseOp::Column {
                change:
                    ColumnChange::Create {
                        definition: NewColumn::New { name, kind, .. },
                        ..
                    },
                ..
            } => Some((name.clone(), *kind)),
            _ => None,
        })
        .collect();
    assert_eq!(
        created,
        [("Severity".to_string(), ColumnKind::Select { multi: false })]
    );

    // Then the rows, title first.
    let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &batches[1][0]
    else {
        panic!("expected a row insert, got {:?}", batches[1]);
    };
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0][0],
        CellWrite {
            column: ColumnId::from_uuid(TITLE_COLUMN),
            value: CellValue::Text("Login fails".to_string()),
        }
    );
    assert!(matches!(rows[0][1].value, CellValue::Options(_)));
    assert_eq!(rows[1].len(), 1, "an empty row keeps only its title");

    // The row with a body got a document in a folder beside the database,
    // linked from its Page column.
    assert_eq!(
        writer.folders.lock().unwrap().as_slice(),
        [("Bugs pages".to_string(), Some(folder))]
    );
    let documents = writer.documents.lock().unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].name, "Login fails");
    assert!(documents[0].markdown.contains("Steps to reproduce"));
    assert_eq!(
        documents[0].links, links,
        "row bodies resolve the import's pages"
    );
    // The Page column is created first in the table...
    let DatabaseOp::Column {
        column: page_column,
        change:
            ColumnChange::Create {
                definition: NewColumn::New { name, kind, .. },
                ..
            },
        ..
    } = &batches[2][0]
    else {
        panic!("expected the Page column, got {:?}", batches[2]);
    };
    assert_eq!(name, "Page");
    assert_eq!(
        *kind,
        ColumnKind::Entity {
            target: EntityKind::Document,
            multi: false
        }
    );
    let DatabaseOp::Table {
        change: TableChange::ReorderColumns { order },
        ..
    } = &batches[2][1]
    else {
        panic!("expected the column order, got {:?}", batches[2]);
    };
    assert_eq!(order[0], *page_column);
    assert_eq!(order[1], ColumnId::from_uuid(TITLE_COLUMN));
    assert_eq!(order.len(), 3);
    // ...then filled with the row's document.
    let DatabaseOp::Rows {
        change:
            RowsChange::Update {
                changes: RowChanges::PerRow { rows: linked },
            },
        ..
    } = &batches[3][0]
    else {
        panic!("expected the Page links, got {:?}", batches[3]);
    };
    assert_eq!(linked.len(), 1);
    assert_eq!(linked[0].row, RowId::from_uuid(Uuid::from_u128(700)));
    assert_eq!(
        linked[0].cells[0].value,
        CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::Document,
            entity_id: derived_id(Uuid::from_u128(1), &format!("body/{}", id('1').as_str()))
                .to_string(),
        }])
    );

    assert_eq!(written.database_id, DATABASE);
    assert!(
        writer.shares.lock().unwrap().is_empty(),
        "a personal database shares nothing"
    );
    assert_eq!(written.rows.len(), 2);
    assert_eq!(written.relations.len(), 1);
    assert_eq!(written.relations[0].name, "Project");
    assert_eq!(written.relations[0].target, Some(id('9')));
    assert_eq!(
        written.relations[0].links,
        [(RowId::from_uuid(Uuid::from_u128(700)), vec![id('8')])]
    );
}

#[tokio::test]
async fn a_shared_database_is_shared_with_its_row_bodies_folder() {
    let notion = FakeNotion {
        fetched: Mutex::new(0),
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
            notion_row('2', "Typo on pricing", vec![]),
        ],
        bodies: [(id('1'), "Steps to reproduce".to_string())]
            .into_iter()
            .collect(),
    };
    let writer = FakeWriter::default();
    let source_item = source_item("Bugs");
    let store = FakeStore::default();
    let user = user();
    let progress = Progress::new(&store, &user, source_item.import_id, &[]);

    write_database(
        &notion,
        &writer,
        &user,
        &source_item,
        Uuid::from_u128(42),
        true,
        &PeopleMap::new(),
        &NotionLinks::default(),
        &progress,
        &Cancel::default(),
    )
    .await
    .unwrap();

    assert_eq!(
        writer.folders.lock().unwrap().as_slice(),
        [("Bugs pages".to_string(), Some(Uuid::from_u128(42)))]
    );
    assert_eq!(
        writer.shares.lock().unwrap().as_slice(),
        [
            SharedEntity::Database(DATABASE),
            SharedEntity::Folder(Uuid::from_u128(901)),
        ]
    );
}

#[tokio::test]
async fn a_cancelled_import_stops_before_writing_rows() {
    let notion = FakeNotion {
        fetched: Mutex::new(0),
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Bugs".to_string(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: Vec::new(),
        },
        rows: vec![notion_row('1', "Login fails", vec![])],
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    let cancel = Cancel::default();
    cancel.stop();
    let source_item = source_item("Bugs");
    let store = FakeStore::default();
    let user = user();
    let progress = Progress::new(&store, &user, source_item.import_id, &[]);

    let outcome = write_database(
        &notion,
        &writer,
        &user,
        &source_item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &NotionLinks::default(),
        &progress,
        &cancel,
    )
    .await;

    assert_eq!(outcome.unwrap_err().to_string(), "Cancelled");
    let batches = writer.batches.lock().unwrap();
    assert_eq!(batches.len(), 1, "only the schema was written");
    assert!(
        !batches[0]
            .iter()
            .any(|op| matches!(op, DatabaseOp::Rows { .. }))
    );
}

#[test]
fn the_page_column_never_takes_a_name_the_data_source_already_uses() {
    let property = |name: &str| NotionPropertySchema {
        id: name.to_string(),
        name: name.to_string(),
        kind: NotionPropertyKind::RichText,
    };
    assert_eq!(page_column_name(&[property("Status")]), "Page");
    assert_eq!(page_column_name(&[property("page")]), "Page (Notion)");
    assert_eq!(
        page_column_name(&[property("Page"), property("Page (Notion)")]),
        "Page 2"
    );
}

#[tokio::test]
async fn a_database_whose_rows_have_no_content_gets_no_page_column() {
    let notion = FakeNotion {
        fetched: Mutex::new(0),
        source: NotionDataSource {
            id: id('e'),
            database_id: id('f'),
            title: "Partners".to_string(),
            database_parent: NotionParent::Workspace,
            in_trash: false,
            properties: Vec::new(),
        },
        rows: vec![notion_row('1', "Acme", vec![])],
        bodies: HashMap::new(),
    };
    let writer = FakeWriter::default();
    let source_item = source_item("Partners");
    let store = FakeStore::default();
    let user = user();
    let progress = Progress::new(&store, &user, source_item.import_id, &[]);

    write_database(
        &notion,
        &writer,
        &user,
        &source_item,
        Uuid::from_u128(42),
        false,
        &PeopleMap::new(),
        &NotionLinks::default(),
        &progress,
        &Cancel::default(),
    )
    .await
    .unwrap();

    let batches = writer.batches.lock().unwrap();
    assert_eq!(batches.len(), 2, "schema and rows only");
    assert!(writer.folders.lock().unwrap().is_empty());
}

fn numbered_row(number: u128) -> NotionPage {
    let id = NotionId::parse(&format!("{number:032x}")).unwrap();
    NotionPage {
        id: id.clone(),
        title: format!("Row {number}"),
        url: id.url(),
        parent: NotionParent::DataSource {
            data_source: self::id('e'),
            database: self::id('f'),
        },
        last_edited: Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::new(),
    }
}

fn inserted(batches: &[Vec<DatabaseOp>]) -> usize {
    batches
        .iter()
        .flatten()
        .map(|op| match op {
            DatabaseOp::Rows {
                change: RowsChange::Insert { rows },
                ..
            } => rows.len(),
            _ => 0,
        })
        .sum()
}

#[tokio::test]
async fn a_database_stopped_part_way_through_its_rows_resumes_without_duplicates() {
    // 600 rows: two insert batches, the second lost with its process.
    let notion = FakeNotion {
        fetched: Mutex::new(0),
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
        &NotionLinks::default(),
        &Progress::new(&store, &user, item.import_id, &[]),
        &Cancel::default(),
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
        &NotionLinks::default(),
        &Progress::new(&store, &user, item.import_id, &recorded),
        &Cancel::default(),
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
        fetched: Mutex::new(0),
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
        &NotionLinks::default(),
        &Progress::new(&store, &user, item.import_id, &[]),
        &Cancel::default(),
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
        &NotionLinks::default(),
        &Progress::new(&store, &user, item.import_id, &recorded),
        &Cancel::default(),
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
