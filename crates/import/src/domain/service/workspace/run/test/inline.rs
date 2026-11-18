// Synthetic Notion-Version 2026-03-11 shapes:
// https://developers.notion.com/reference/view
// https://developers.notion.com/guides/data-apis/enhanced-markdown
use super::*;
use crate::domain::ports::{NotionDatabaseFallback, NotionDatabaseTarget};
use import_notion::domain::model::{
    NotionParent, NotionPropertyKind, NotionPropertySchema, RowsNext,
};
use import_notion::domain::views::{NotionView, ViewScope};

struct Inline;
impl NotionApi for Inline {
    async fn page(&self, id: &NotionId) -> std::result::Result<NotionPage, NotionError> {
        let mut page = Pages.page(id).await?;
        page.title = "Row".into();
        page.parent = NotionParent::DataSource {
            data_source: page_id('d'),
            database: page_id('a'),
        };
        Ok(page)
    }
    async fn page_markdown(&self, id: &NotionId) -> std::result::Result<PageMarkdown, NotionError> {
        let markdown = if *id == page_id('e') {
            "Before\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=cccccccccccccccccccccccccccccccc\" inline=\"true\">Work</database>\nBetween\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\" inline=\"true\">Work</database>\nAfter"
        } else {
            "Row before\n<database url=\"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\" inline=\"true\">Work</database>\nRow after"
        };
        Ok(PageMarkdown {
            markdown: markdown.into(),
            unknown_block_ids: vec![],
        })
    }
    async fn data_source(
        &self,
        id: &NotionId,
    ) -> std::result::Result<NotionDataSource, NotionError> {
        Ok(NotionDataSource {
            id: id.clone(),
            database_id: if *id == page_id('d') {
                page_id('a')
            } else {
                page_id('6')
            },
            title: "Work".into(),
            database_parent: if *id == page_id('d') {
                NotionParent::Page { id: page_id('e') }
            } else {
                NotionParent::Workspace
            },
            in_trash: false,
            properties: vec![NotionPropertySchema {
                id: "title".into(),
                name: "Name".into(),
                kind: NotionPropertyKind::Title,
            }],
        })
    }
    async fn database_sources(
        &self,
        _: &NotionId,
    ) -> std::result::Result<Vec<NotionId>, NotionError> {
        Ok(vec![page_id('d')])
    }
    async fn list_views(
        &self,
        scope: &ViewScope,
        _: Option<String>,
    ) -> std::result::Result<Paged<NotionId>, NotionError> {
        if matches!(scope, ViewScope::DataSource(id) if *id != page_id('d')) {
            return Ok(Paged {
                results: vec![],
                next_cursor: None,
            });
        }
        Ok(Paged {
            results: vec![page_id('b'), page_id('c')],
            next_cursor: None,
        })
    }
    async fn retrieve_view(&self, id: &NotionId) -> std::result::Result<NotionView, NotionError> {
        Ok(serde_json::from_value(serde_json::json!({
            "object":"view", "id":id, "name":"Work", "type":"table",
            "parent":{"database_id":page_id('a')}, "data_source_id":page_id('d'),
            "filter": if *id == page_id('c') { Some(serde_json::json!({"property":"unknown", "people":{"contains":"me"}})) } else { None },
        })).unwrap())
    }
    async fn query_data_source(
        &self,
        id: &NotionId,
        _: Option<String>,
    ) -> std::result::Result<RowsPage, NotionError> {
        let rows = if *id == page_id('d') {
            vec![self.page(&page_id('f')).await?]
        } else {
            vec![]
        };
        Ok(RowsPage {
            rows,
            next: RowsNext::End,
        })
    }
    async fn users(
        &self,
        _: Option<String>,
    ) -> std::result::Result<Paged<NotionUser>, NotionError> {
        Ok(Paged {
            results: vec![],
            next_cursor: None,
        })
    }
    async fn search(
        &self,
        _: SearchObject,
        _: Option<String>,
    ) -> std::result::Result<Paged<SearchHit>, NotionError> {
        unreachable!("approved snapshot")
    }
}
struct InlineConnected;
impl NotionConnections for InlineConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn databases_and_views_exist_before_page_and_row_cards_and_sharing_stays_independent(
    pool: PgPool,
) {
    let owner = teammate(&pool, "inline-owner", Uuid::now_v7()).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    source.parent_foreign_id = Some(page_id('e').to_string());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let (review, _) = approved(&pool, &owner, &[planned_page('e', "Project", true), source]).await;
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.imported, 2);
    let databases = service.creator.databases.lock().unwrap();
    assert_eq!(databases.len(), 1);
    assert!(databases[0].1.is_some(), "filed in its page folder");
    let database = databases[0].0;
    drop(databases);
    let saved = service.creator.saved_views.lock().unwrap();
    assert_eq!(saved.len(), 2);
    assert_ne!(saved[0].2.name, saved[1].2.name);
    assert!(saved[1].2.name.contains("filter approximated"));
    let first = saved[0].1;
    let second = saved[1].1;
    drop(saved);
    let steps = service.creator.steps.lock().unwrap();
    let first_body = steps.iter().position(|step| *step == "document").unwrap();
    assert!(
        steps
            .iter()
            .enumerate()
            .filter(|(_, step)| **step == "view")
            .all(|(position, _)| position < first_body)
    );
    drop(steps);
    let documents = service.creator.documents.lock().unwrap();
    assert_eq!(documents.len(), 2, "page and row body");
    let page = documents
        .iter()
        .find(|(_, title, _)| title == "Project")
        .unwrap();
    assert_eq!(page.2.databases.len(), 2);
    assert!(
        matches!(page.2.databases[0].target, NotionDatabaseTarget::Resolved { database_id, view_id: Some(view), .. } if database_id == database && view == second)
    );
    assert!(
        matches!(page.2.databases[1].target, NotionDatabaseTarget::Resolved { database_id, view_id: Some(view), .. } if database_id == database && view == first)
    );
    let row = documents
        .iter()
        .find(|(_, title, _)| title == "Row")
        .unwrap();
    assert!(
        matches!(row.2.databases[0].target, NotionDatabaseTarget::Resolved { database_id, .. } if database_id == database)
    );
    drop(documents);
    assert!(
        service
            .creator
            .shares
            .lock()
            .unwrap()
            .iter()
            .all(|share| matches!(share, SharedEntity::Document(_)))
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("default tab assumed"))
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("Filter at"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn excluded_sources_keep_named_notion_links_in_the_page(pool: PgPool) {
    let owner = user("inline-excluded");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    source.metadata["plan"]["dependencyOf"] = serde_json::json!([page_id('e')]);
    let (review, rows) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(
            &owner,
            review,
            NotionWriteChoices {
                excluded: vec![rows[1]],
                ..NotionWriteChoices::default()
            },
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let documents = service.creator.documents.lock().unwrap();
    assert_eq!(documents.len(), 1);
    assert!(
        documents[0]
            .2
            .databases
            .iter()
            .all(|occurrence| occurrence.target
                == NotionDatabaseTarget::Fallback(NotionDatabaseFallback::NotImported))
    );
    assert!(service.creator.databases.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_personal_database_uses_top_level_when_no_private_folder_exists(pool: PgPool) {
    let owner = user("inline-root");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer {
            no_private_folder: true,
            ..Writer::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    source.parent_foreign_id = Some(page_id('e').to_string());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert!(report.failures.is_empty());
    assert_eq!(service.creator.databases.lock().unwrap()[0].1, None);
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("filed at top level"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn folder_sharing_finishes_before_any_database_is_filed(pool: PgPool) {
    let owner = teammate(&pool, "inline-team", Uuid::now_v7()).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    let mut source = planned_page('d', "Work", true);
    source.kind = ImportKind::DataSource;
    source.parent_foreign_id = Some(page_id('e').to_string());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let (review, _) = approved(&pool, &owner, &[planned_page('e', "Project", true), source]).await;
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert!(
        service
            .notion_import_report(&owner)
            .await
            .unwrap()
            .failures
            .is_empty()
    );
    let steps = service.creator.steps.lock().unwrap();
    let filing = steps.iter().position(|step| *step == "database").unwrap();
    // The row-body folder is new and cannot contain a reserved database.
    let parent_share = steps
        .iter()
        .position(|step| *step == "share_folder")
        .unwrap();
    assert!(parent_share < filing);
    assert!(steps.iter().any(|step| *step == "share_database"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn same_titles_from_distinct_workspaces_keep_distinct_source_destinations(pool: PgPool) {
    let owner = user("inline-identities");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    let mut first = planned_page('d', "Work", false);
    first.kind = ImportKind::DataSource;
    first.parent_foreign_id = Some(page_id('e').to_string());
    // Two workspaces supply distinct globally unique source/container UUIDs.
    // Neither their shared title nor the importing owner may collapse them.
    let mut second = planned_page('5', "Work", false);
    second.kind = ImportKind::DataSource;
    second.parent_foreign_id = None;
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), first, second],
    )
    .await;
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    let databases = service.creator.databases.lock().unwrap();
    assert_eq!(databases.len(), 2);
    assert_ne!(databases[0].0, databases[1].0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_waiting_database_keeps_its_own_outcome_when_a_page_finishes_later(pool: PgPool) {
    let team = Uuid::now_v7();
    let first = teammate(&pool, "inline-holder", team).await;
    let owner = teammate(&pool, "inline-waiter", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let mut source = planned_page('d', "Work", true);
    source.kind = ImportKind::DataSource;
    let (_, holders) = approved(&pool, &first, &[source.clone()]).await;
    repo.start_run(&first, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        &first,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.take_run(
        &first,
        Uuid::now_v7(),
        LEASE,
        &NotionJob::Plan {
            scope: import_notion::domain::model::ImportScope::Everything,
            sharing: NotionSharing::Team,
        },
    )
    .await
    .unwrap();
    repo.claim_importing(&first, &holders, &holders, Some(team))
        .await
        .unwrap();
    let (review, rows) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    // Put the page first in the input even though its body/write needs more
    // service calls than the already-claimed source's waiting outcome.
    sqlx::query!(
        "UPDATE import_entity SET created_at = created_at + INTERVAL '1 minute' WHERE id = $1",
        rows[0]
    )
    .execute(&pool)
    .await
    .unwrap();
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let waiting = repo.get(&owner, rows[1]).await.unwrap().unwrap();
    assert_eq!(waiting.waiting_on, Some(holders[0]));
    assert_eq!(
        repo.get(&owner, rows[0]).await.unwrap().unwrap().status,
        ImportStatus::Imported
    );
    assert_eq!(service.creator.documents.lock().unwrap().len(), 1);
    assert_eq!(
        service
            .notion_import_report(&owner)
            .await
            .unwrap()
            .waiting_on_teammates,
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammates_source_uses_its_authorized_recorded_table_and_fidelity_report(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use models_databases::{
        TableId,
        views::{NewView, RequestedLayout, ViewId, ViewQuery},
    };
    let team = Uuid::now_v7();
    let holder = teammate(&pool, "inline-table-holder", team).await;
    let owner = teammate(&pool, "inline-table-peer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let mut source = planned_page('d', "Work", true);
    source.kind = ImportKind::DataSource;
    let (_, held) = approved(&pool, &holder, &[source.clone()]).await;
    repo.claim_importing(&holder, &held, &held, Some(team))
        .await
        .unwrap();
    let database = Uuid::from_u128(5000);
    let canonical = TableId::from_uuid(Uuid::from_u128(5010));
    repo.record_written(
        &holder,
        &[
            WrittenObject::own(held[0], WrittenKind::Database, database),
            WrittenObject::own(held[0], WrittenKind::Table, canonical.into_uuid()),
        ],
    )
    .await
    .unwrap();
    repo.record_warnings(
        &holder,
        held[0],
        &["Stored view filter approximated".into()],
    )
    .await
    .unwrap();
    repo.mark_imported(&holder, held[0], &database.to_string(), "database", None)
        .await
        .unwrap();
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&repo, &owner).await;
    let writer = Writer::default();
    for notion in [page_id('b'), page_id('c')] {
        writer.saved_views.lock().unwrap().push((
            database,
            ViewId::from_uuid(import_notion::domain::macro_cells::derived_id(
                database,
                &format!("view/{notion}"),
            )),
            NewView {
                name: "Work (filter approximated)".into(),
                query: ViewQuery::default(),
                layout: RequestedLayout::Table { columns: vec![] },
            },
        ));
    }
    let tracker = TaskTracker::new();
    let service = service(&pool, writer, CancellationToken::new(), tracker.clone())
        .with_notion_connections(Arc::new(InlineConnected));
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert!(
        service.creator.databases.lock().unwrap().is_empty(),
        "the shared copy is reused"
    );
    assert_eq!(
        service.creator.database_reads.lock().unwrap().as_slice(),
        &[(database, canonical)]
    );
    let documents = service.creator.documents.lock().unwrap();
    assert_eq!(documents.len(), 1);
    assert!(documents[0].2.databases.iter().all(|occurrence| matches!(occurrence.target, NotionDatabaseTarget::Resolved { database_id, table_id, .. } if database_id == database && table_id == canonical)));
    drop(documents);
    assert!(
        service
            .notion_import_report(&owner)
            .await
            .unwrap()
            .warnings
            .contains(&"Stored view filter approximated".into())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_shared_source_without_a_holder_table_marker_keeps_unresolved_links(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    let team = Uuid::now_v7();
    let holder = teammate(&pool, "inline-missing-holder", team).await;
    let owner = teammate(&pool, "inline-missing-peer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let mut source = planned_page('d', "Work", true);
    source.kind = ImportKind::DataSource;
    let (_, held) = approved(&pool, &holder, &[source.clone()]).await;
    repo.claim_importing(&holder, &held, &held, Some(team))
        .await
        .unwrap();
    let database = Uuid::from_u128(6000);
    repo.record_written(
        &holder,
        &[WrittenObject::own(held[0], WrittenKind::Database, database)],
    )
    .await
    .unwrap();
    repo.mark_imported(&holder, held[0], &database.to_string(), "database", None)
        .await
        .unwrap();
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert!(service.creator.database_reads.lock().unwrap().is_empty());
    let documents = service.creator.documents.lock().unwrap();
    assert!(
        documents[0]
            .2
            .databases
            .iter()
            .all(|occurrence| occurrence.target
                == NotionDatabaseTarget::Fallback(NotionDatabaseFallback::Unresolved))
    );
    drop(documents);
    assert!(
        service
            .notion_import_report(&owner)
            .await
            .unwrap()
            .warnings
            .iter()
            .any(|warning| warning.contains("table marker is missing"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_approved_tasks_source_keeps_not_imported_links_in_its_page(pool: PgPool) {
    let owner = user("inline-tasks");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    source.metadata["plan"]["decision"] = serde_json::json!("tasks");
    source.metadata["plan"]["inlineOn"] = serde_json::json!([page_id('e')]);
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(service.creator.tasks.lock().unwrap().len(), 1);
    assert!(service.creator.databases.lock().unwrap().is_empty());
    let documents = service.creator.documents.lock().unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].2.databases.len(), 2);
    assert!(
        documents[0]
            .2
            .databases
            .iter()
            .all(|occurrence| occurrence.target
                == NotionDatabaseTarget::Fallback(NotionDatabaseFallback::NotImported))
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|loss| loss.contains("NotImported"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_changed_schema_on_resume_stops_only_its_source_and_falls_back_in_cards(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use crate::domain::ports::WrittenObjects;
    let owner = user("inline-schema-drift");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (review, rows) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    let import_id = rows[1];
    let database = import_notion::domain::macro_cells::derived_id(import_id, "database");
    repo.record_written(
        &owner,
        &[
            WrittenObject::own(import_id, WrittenKind::Database, database),
            WrittenObject::own(import_id, WrittenKind::Table, Uuid::from_u128(501)),
            WrittenObject::own(import_id, WrittenKind::TitleColumn, Uuid::from_u128(502)),
            WrittenObject::own(import_id, WrittenKind::Schema, database),
            // The earlier process planned a different property schema.
            WrittenObject::own(import_id, WrittenKind::SchemaPlan, Uuid::from_u128(503)),
        ],
    )
    .await
    .unwrap();
    repo.finish_run(&owner, ImportSource::Notion, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Completed));
    assert_eq!(report.imported, 1, "the unrelated page still imports");
    assert_eq!(report.failures.len(), 1);
    assert!(
        report
            .warnings
            .iter()
            .any(|loss| loss.contains("source schema changed"))
    );
    let documents = service.creator.documents.lock().unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].2.databases.len(), 2);
    assert!(
        documents[0]
            .2
            .databases
            .iter()
            .all(|occurrence| occurrence.target
                == NotionDatabaseTarget::Fallback(NotionDatabaseFallback::Unresolved))
    );
    assert!(
        service.creator.databases.lock().unwrap().is_empty(),
        "the reserved database is not duplicated"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoked_database_grant_prevents_holder_lookup_and_keeps_no_access_links(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    let team = Uuid::now_v7();
    let holder = teammate(&pool, "inline-denied-holder", team).await;
    let owner = teammate(&pool, "inline-denied-peer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let mut source = planned_page('d', "Work", true);
    source.kind = ImportKind::DataSource;
    let (_, held) = approved(&pool, &holder, &[source.clone()]).await;
    repo.claim_importing(&holder, &held, &held, Some(team))
        .await
        .unwrap();
    let database = Uuid::from_u128(6000);
    repo.record_written(
        &holder,
        &[WrittenObject::own(held[0], WrittenKind::Database, database)],
    )
    .await
    .unwrap();
    repo.mark_imported(&holder, held[0], &database.to_string(), "database", None)
        .await
        .unwrap();
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer {
            deny_database_access: true,
            ..Writer::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert!(service.creator.database_reads.lock().unwrap().is_empty());
    let documents = service.creator.documents.lock().unwrap();
    assert!(
        documents[0]
            .2
            .databases
            .iter()
            .all(|occurrence| occurrence.target
                == NotionDatabaseTarget::Fallback(NotionDatabaseFallback::NoAccess))
    );
    drop(documents);
    assert!(
        service
            .notion_import_report(&owner)
            .await
            .unwrap()
            .warnings
            .iter()
            .any(|warning| warning.contains("view access unavailable"))
    );
}
