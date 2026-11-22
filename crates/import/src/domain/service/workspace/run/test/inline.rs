// Synthetic Notion-Version 2026-03-11 shapes:
// https://developers.notion.com/reference/view
// https://developers.notion.com/guides/data-apis/enhanced-markdown
use super::*;
use crate::domain::ports::{NotionDatabaseFallback, NotionDatabaseTarget};
use import_notion::domain::model::{
    NotionParent, NotionPropertyKind, NotionPropertySchema, RowsNext,
};

mod fixture;
use fixture::{Inline, InlineConnected};

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
    assert!(
        report.warnings.iter().any(|loss| loss.contains("Work")),
        "loss reports identify the database by its title"
    );
    assert!(
        report
            .warnings
            .iter()
            .all(|loss| ['a', 'b', 'c', 'd', 'e', 'f']
                .iter()
                .all(|id| !loss.contains(page_id(*id).as_str()))),
        "loss reports use titles, not raw object identifiers"
    );
    assert_eq!(report.imported, 2);
    let databases = service.creator.databases.lock().unwrap();
    assert_eq!(databases.len(), 1);
    assert!(databases[0].1.is_some(), "filed in its page folder");
    let database = databases[0].0;
    drop(databases);
    let saved = service.creator.saved_views.lock().unwrap();
    assert_eq!(saved.len(), 2);
    assert_ne!(saved[0].2.name, saved[1].2.name);
    assert!(saved[1].2.name.ends_with(" ≈"));
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
            .any(|warning| warning.contains("filter") && warning.contains("additional rows"))
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
    source.parent_foreign_id = Some(page_id('e').to_string());
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
    assert!(
        !service
            .creator
            .folders
            .lock()
            .unwrap()
            .iter()
            .any(|name| name == "Project"),
        "an excluded child source must not turn its page into a folder"
    );
    drop(documents);
    let report = service.notion_import_report(&owner).await.unwrap();
    assert!(
        report.warnings.iter().any(|warning| {
            warning.contains("Work") && warning.contains("were not imported as a database")
        }),
        "an excluded reviewed source must report NotImported: {:?}",
        report.warnings
    );
    assert!(
        report
            .warnings
            .iter()
            .all(|warning| !warning.contains("were not reviewed"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_personal_database_keeps_its_safe_page_folder(pool: PgPool) {
    let owner = user("inline-root");
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
    let folder = service.creator.databases.lock().unwrap()[0]
        .1
        .expect("safe page folder");
    assert!(
        !service
            .creator
            .folder_has_explicit_grant(&owner, folder)
            .await
            .unwrap()
    );
    assert_eq!(
        repo.personal_root_folder(&owner).await.unwrap(),
        None,
        "no relocation is needed for a private source path"
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
async fn a_waiting_database_stops_bodies_until_a_retry_can_resolve_its_holder(pool: PgPool) {
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
    assert!(
        service.creator.documents.lock().unwrap().is_empty(),
        "a waiting reservation must not permanently downgrade page cards"
    );
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Failed));
    assert!(
        report
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Work") && error.contains("teammate"))
    );
    let database = Uuid::from_u128(6001);
    repo.record_written(
        &first,
        &[
            crate::domain::models::WrittenObject::own(
                holders[0],
                crate::domain::models::WrittenKind::Database,
                database,
            ),
            crate::domain::models::WrittenObject::own(
                holders[0],
                crate::domain::models::WrittenKind::Table,
                Uuid::from_u128(501),
            ),
        ],
    )
    .await
    .unwrap();
    repo.mark_imported(&first, holders[0], &database.to_string(), "database", None)
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.wait().await;
    assert_eq!(
        repo.get(&owner, rows[0]).await.unwrap().unwrap().status,
        ImportStatus::Imported
    );
    let documents = service.creator.documents.lock().unwrap();
    assert_eq!(documents.len(), 1);
    assert!(documents[0].2.databases.iter().all(|occurrence| matches!(occurrence.target, NotionDatabaseTarget::Resolved { database_id, .. } if database_id == database)));
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
            .any(|loss| loss.contains("not imported as a database"))
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
            .any(|warning| warning.contains("could not be opened"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_personal_inline_database_never_lands_under_a_team_shared_folder(pool: PgPool) {
    let owner = teammate(&pool, "personal-inline-owner", Uuid::now_v7()).await;
    let tracker = TaskTracker::new();
    let root = Uuid::now_v7();
    let writer = Writer::default();
    writer.grants.lock().unwrap().insert(root);
    let service = service(&pool, writer, CancellationToken::new(), tracker.clone())
        .with_notion_connections(Arc::new(InlineConnected));
    let repo = service.repo.clone();
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.set_root_folder(&owner, root).await.unwrap();
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
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
    let folder = service.creator.databases.lock().unwrap()[0]
        .1
        .expect("personal mirror folder");
    assert!(
        !service
            .creator
            .folder_has_explicit_grant(&owner, folder)
            .await
            .unwrap(),
        "Personal database must never be filed under a team grant"
    );
    let personal_root = repo
        .personal_root_folder(&owner)
        .await
        .unwrap()
        .expect("persisted personal root");
    assert_ne!(personal_root, root);
    assert_eq!(
        folder, personal_root,
        "the rootless inline source uses the persisted personal mirror root"
    );
    assert!(
        service
            .creator
            .folder_visibilities
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == "Notion (personal)" || name == "Project")
            .all(|(_, visibility)| *visibility == crate::domain::ports::ImportVisibility::Personal)
    );
    assert!(
        !service
            .creator
            .shares
            .lock()
            .unwrap()
            .iter()
            .any(|entity| matches!(entity, SharedEntity::Database(_)))
    );
}

mod failures;
mod review;

mod final_audit;

mod sustained;
