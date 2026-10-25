//! A Notion write outliving its process, against the real ledger: handing
//! the run over on shutdown, and adopting and finishing a stalled write.

use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::notification::{
    ImportOutcome, NotificationEvent, ReviewSettlement,
};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::{
    NotificationFuture, NotificationWriter, PendingNotification,
};
use import_notion::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged, SearchHit,
    SearchObject,
};
use import_notion::domain::ports::{NotionApi, NotionError};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::{PgConnection, PgPool};
use tokio::sync::Notify;
use tokio_util::task::TaskTracker;

use super::*;
use crate::domain::models::{
    ImportKind, ImportTargetReservation, NotionDocMeta, NotionPlanItem, NotionSharing,
    NotionWriteChoices,
};
use crate::domain::ports::{
    ImportedDocumentProperties, ImportedTaskProperties, NewDatabase, NotionLinks, PlanRow,
    SharedEntity, TeamMember,
};
use crate::domain::service::NotionWorkspaceImporter;
use crate::domain::service::test::admission::NoConnector;
use crate::outbound::pg_import_repo::PgImportRepo;

fn page_id(hex: char) -> NotionId {
    NotionId::parse(&hex.to_string().repeat(32)).unwrap()
}

/// A workspace of plain pages, each with a body.
struct Pages;

impl NotionApi for Pages {
    async fn search(
        &self,
        _: SearchObject,
        _: Option<String>,
    ) -> std::result::Result<Paged<SearchHit>, NotionError> {
        unimplemented!("writing never searches")
    }

    async fn page(&self, _: &NotionId) -> std::result::Result<NotionPage, NotionError> {
        Err(NotionError::NotFound)
    }

    async fn page_markdown(&self, id: &NotionId) -> std::result::Result<PageMarkdown, NotionError> {
        Ok(PageMarkdown {
            markdown: format!("Body of {id}"),
            unknown_block_ids: Vec::new(),
        })
    }

    async fn data_source(
        &self,
        _: &NotionId,
    ) -> std::result::Result<NotionDataSource, NotionError> {
        unimplemented!("only pages here")
    }

    async fn database_sources(
        &self,
        _: &NotionId,
    ) -> std::result::Result<Vec<NotionId>, NotionError> {
        unimplemented!("only pages here")
    }

    async fn query_data_source(
        &self,
        _: &NotionId,
        _: Option<String>,
    ) -> std::result::Result<Paged<NotionPage>, NotionError> {
        unimplemented!("only pages here")
    }

    async fn users(
        &self,
        _: Option<String>,
    ) -> std::result::Result<Paged<NotionUser>, NotionError> {
        Ok(Paged {
            results: Vec::new(),
            next_cursor: None,
        })
    }
}

struct Connected;

impl NotionConnections for Connected {
    type Api = Pages;

    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Pages>, NotionError> {
        Ok(Some(Pages))
    }
}

/// Records the documents and folders a write makes. With `hold` set, a
/// document write waits until the process is shutting down and then fails,
/// as a write cut off by a deploy does.
#[derive(Default)]
struct Writer {
    folders: Mutex<Vec<String>>,
    documents: Mutex<Vec<(Uuid, String, NotionLinks)>>,
    shares: Mutex<Vec<SharedEntity>>,
    hold: Option<(Arc<Notify>, tokio_util::sync::CancellationToken)>,
}

impl WorkspaceWriter for Writer {
    async fn create_folder(
        &self,
        _: &MacroUserIdStr<'static>,
        name: &str,
        _: Option<Uuid>,
    ) -> anyhow::Result<Uuid> {
        self.folders.lock().unwrap().push(name.to_string());
        Ok(Uuid::now_v7())
    }

    async fn folder_exists(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> anyhow::Result<bool> {
        Ok(true)
    }

    async fn share_with_team(
        &self,
        _: &MacroUserIdStr<'static>,
        entity: SharedEntity,
    ) -> anyhow::Result<()> {
        self.shares.lock().unwrap().push(entity);
        Ok(())
    }

    async fn create_document(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        _: &str,
        links: &NotionLinks,
        _: &ImportedDocumentProperties,
        _: Option<Uuid>,
    ) -> anyhow::Result<String> {
        if let Some((entered, shutdown)) = &self.hold {
            entered.notify_one();
            shutdown.cancelled().await;
            anyhow::bail!("the process stopped");
        }
        self.documents
            .lock()
            .unwrap()
            .push((id, name.to_string(), links.clone()));
        Ok(id.to_string())
    }

    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &str,
        _: &str,
        _: &NotionLinks,
        _: &ImportedTaskProperties,
        _: Option<Uuid>,
    ) -> anyhow::Result<String> {
        unimplemented!("only pages here")
    }

    async fn create_database(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> anyhow::Result<NewDatabase> {
        unimplemented!("only pages here")
    }

    async fn apply_database_ops(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: Vec<models_databases::DatabaseOp>,
    ) -> anyhow::Result<Vec<models_databases::OpResult>> {
        unimplemented!("only pages here")
    }

    async fn team_members(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<TeamMember>> {
        Ok(Vec::new())
    }
}

impl EntityCreator for Writer {
    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        unimplemented!("workspace imports write through WorkspaceWriter")
    }

    async fn create_notion_document(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &NotionLinks,
        _: &ImportedDocumentProperties,
    ) -> anyhow::Result<String> {
        unimplemented!("workspace imports write through WorkspaceWriter")
    }

    async fn create_channel(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &ImportTargetReservation,
        _: &[String],
    ) -> anyhow::Result<Uuid> {
        unimplemented!("workspace imports write no channels")
    }
}

type Service = ImportServiceImpl<
    PgImportRepo,
    NoConnector,
    Writer,
    crate::domain::service::NoSlackSource,
    Connected,
>;

fn service(
    pool: &PgPool,
    writer: Writer,
    shutdown: tokio_util::sync::CancellationToken,
    tracker: TaskTracker,
) -> Service {
    ImportServiceImpl::new(
        PgImportRepo::new(pool.clone()),
        Arc::new(NoConnector),
        Arc::new(writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(shutdown, tracker)
}

fn user(label: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{label}@example.com"))
        .unwrap()
        .into_owned()
}

fn page(hex: char, title: &str) -> PlanRow {
    planned_page(hex, title, false)
}

/// A page planned as a document, shared with the team or not.
fn planned_page(hex: char, title: &str, shared: bool) -> PlanRow {
    let plan = NotionPlanItem {
        decision: Some(NotionDecision::Copy),
        reason: None,
        path: Vec::new(),
        rows: None,
        sample_titles: Vec::new(),
        task_fields: None,
        shared,
        shared_reason: None,
        shareable: true,
        already_imported: None,
    };
    PlanRow {
        kind: ImportKind::Page,
        foreign_id: page_id(hex).as_str().to_string(),
        parent_foreign_id: None,
        metadata: serde_json::to_value(NotionDocMeta::for_plan(
            title.to_string(),
            page_id(hex).url(),
            plan,
        ))
        .unwrap(),
    }
}

/// A user with an approved two-page plan.
async fn approved_plan(pool: &PgPool, owner: &MacroUserIdStr<'static>) -> (Uuid, Vec<Uuid>) {
    approved(pool, owner, &[page('a', "Roadmap"), page('b', "Spec")]).await
}

/// A user with an approved plan of `rows`.
async fn approved(
    pool: &PgPool,
    owner: &MacroUserIdStr<'static>,
    rows: &[PlanRow],
) -> (Uuid, Vec<Uuid>) {
    let repo = PgImportRepo::new(pool.clone());
    let staged = repo
        .replace_plan(owner, ImportSource::Notion, rows)
        .await
        .unwrap();
    let session = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO agent_session (id, owner_id, bot_id, harness, model, workspace, for_warming) VALUES ($1, $2, '00000000-0000-0000-0000-00000000a2a2', 'macro-inmem', 'test-model', '/workspace', false)"#,
        session,
        owner.as_ref(),
    )
    .execute(pool)
    .await
    .unwrap();
    let review = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO agent_session_review (id, agent_session_id, record) VALUES ($1, $2, '{}'::jsonb)"#,
        review,
        session,
    )
    .execute(pool)
    .await
    .unwrap();
    repo.attach_review(
        owner,
        ImportSource::Notion,
        review,
        AgentSessionId::new_from_uuid(session),
    )
    .await
    .unwrap();
    (review, staged.iter().map(|row| row.id).collect())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_write_cut_off_by_shutdown_hands_its_run_over(pool: PgPool) {
    let owner = user("handover");
    let (review, rows) = approved_plan(&pool, &owner).await;
    let shutdown = tokio_util::sync::CancellationToken::new();
    let tracker = TaskTracker::new();
    let entered = Arc::new(Notify::new());
    let writer = Writer {
        hold: Some((Arc::clone(&entered), shutdown.clone())),
        ..Writer::default()
    };
    let service = service(&pool, writer, shutdown.clone(), tracker.clone());
    let repo = PgImportRepo::new(pool.clone());
    // Planned: the run is ready.
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Ready,
        None,
    )
    .await
    .unwrap();

    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    entered.notified().await;
    shutdown.cancel();
    tracker.close();
    tracker.wait().await;

    let runs = repo.list_runs(&owner).await.unwrap();
    assert_eq!(runs[0].status, RunStatus::Importing, "the run is not over");
    for row in &rows {
        let row = repo.get(&owner, *row).await.unwrap().unwrap();
        assert_eq!(
            row.status,
            ImportStatus::Importing,
            "left for the next process"
        );
        assert_eq!(row.last_error, None);
    }
    let adopted = repo
        .adopt_stalled_runs(Some(&owner), Uuid::now_v7(), LEASE, STALE_UNLEASED, 1)
        .await
        .unwrap();
    assert_eq!(
        adopted.len(),
        1,
        "the lease was given up, so it is adopted at once"
    );
    assert_eq!(adopted[0].job, Some(NotionJob::Write { review_id: review }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stalled_write_is_adopted_on_read_and_finishes_without_duplicates(pool: PgPool) {
    let owner = user("adopt");
    let (review, rows) = approved_plan(&pool, &owner).await;
    let repo = PgImportRepo::new(pool.clone());
    // The first process wrote Roadmap and died while writing Spec; its
    // lease has lapsed.
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.take_run(
        &owner,
        Uuid::now_v7(),
        std::time::Duration::ZERO,
        &NotionJob::Write { review_id: review },
    )
    .await
    .unwrap();
    let root = Uuid::now_v7();
    repo.set_root_folder(&owner, root).await.unwrap();
    repo.mark_importing(&owner, &rows).await.unwrap();
    let roadmap = write::document_id(rows[0]);
    repo.mark_imported(&owner, rows[0], &roadmap.to_string(), "md", None)
        .await
        .unwrap();

    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer::default());
    let service = ImportServiceImpl::new(
        PgImportRepo::new(pool.clone()),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service.notion_import_report(&owner).await.unwrap();
    tracker.close();
    tracker.wait().await;

    let documents = writer.documents.lock().unwrap();
    assert_eq!(documents.len(), 1, "only Spec is written: {documents:?}");
    let (spec, name, links) = &documents[0];
    assert_eq!(name, "Spec");
    assert_eq!(*spec, write::document_id(rows[1]));
    assert_eq!(
        links.pages[&page_id('a')].document_id,
        roadmap,
        "Spec still mentions the Roadmap written before"
    );
    assert!(
        writer.folders.lock().unwrap().is_empty(),
        "the Notion folder is reused"
    );
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Completed));
    assert_eq!(report.imported, 2);
    assert_eq!(report.writing, 0);
    let spec_row = repo.get(&owner, rows[1]).await.unwrap().unwrap();
    assert_eq!(spec_row.entity_id, Some(spec.to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_that_keeps_stopping_is_given_up_with_its_rows_back_in_staged(pool: PgPool) {
    let owner = user("give-up");
    let (review, rows) = approved_plan(&pool, &owner).await;
    let repo = PgImportRepo::new(pool.clone());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.take_run(
        &owner,
        Uuid::now_v7(),
        std::time::Duration::ZERO,
        &NotionJob::Write { review_id: review },
    )
    .await
    .unwrap();
    repo.mark_importing(&owner, &rows).await.unwrap();
    sqlx::query!(
        "UPDATE import_run SET adoptions = $2 WHERE user_id = $1",
        owner.as_ref(),
        i16::try_from(MAX_ADOPTIONS).unwrap(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        tokio_util::sync::CancellationToken::new(),
        tracker.clone(),
    );
    let report = service.notion_import_report(&owner).await.unwrap();
    tracker.close();
    tracker.wait().await;

    assert_eq!(report.status, Some(RunStatus::Failed));
    assert_eq!(report.error.as_deref(), Some(IMPORT_STOPPED));
    assert_eq!(report.writing, 0);
    assert_eq!(report.waiting, 2, "both can be imported again");
}

/// A Macro user on `team`, which is made on first use.
async fn teammate(pool: &PgPool, label: &str, team: Uuid) -> MacroUserIdStr<'static> {
    let id = Uuid::now_v7();
    let email = format!("{label}@example.com");
    let user_id = format!("macro|{email}");
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        id,
        label,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $2, $3)",
        user_id,
        email,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sharing', $2) ON CONFLICT (id) DO NOTHING",
        team,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        user_id,
        team,
    )
    .execute(pool)
    .await
    .unwrap();
    MacroUserIdStr::parse_from_str(&user_id)
        .unwrap()
        .into_owned()
}

/// Move `owner`'s run to `ready`, as planning leaves it.
async fn planned(repo: &PgImportRepo, owner: &MacroUserIdStr<'static>) {
    repo.start_run(owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Ready,
        None,
    )
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_write_shares_what_the_plan_shares_and_keeps_the_rest_with_the_owner(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "share-owner", team).await;
    let (review, rows) = approved(
        &pool,
        &owner,
        &[
            planned_page('a', "Wiki", true),
            planned_page('b', "Journal", false),
            planned_page('c', "Roadmap", true),
        ],
    )
    .await;
    let repo = PgImportRepo::new(pool.clone());
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer::default());
    let service = ImportServiceImpl::new(
        PgImportRepo::new(pool.clone()),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    // The owner keeps the Roadmap to themselves on the card.
    service
        .start_notion_write(
            &owner,
            review,
            NotionWriteChoices {
                personal: vec![rows[2]],
                ..NotionWriteChoices::default()
            },
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    assert_eq!(
        *writer.shares.lock().unwrap(),
        [SharedEntity::Document(write::document_id(rows[0]))],
        "only the Wiki is shared"
    );
    let wiki = repo.get(&owner, rows[0]).await.unwrap().unwrap();
    assert_eq!(wiki.status, ImportStatus::Imported);
    assert_eq!(wiki.team_id, Some(team), "the team's copy of the Wiki");
    let roadmap = repo.get(&owner, rows[2]).await.unwrap().unwrap();
    assert_eq!(roadmap.team_id, None);
    assert_eq!(
        roadmap.metadata["plan"]["shared"], false,
        "the owner's choice is on the row, for a resumed write"
    );
    assert_eq!(writer.documents.lock().unwrap().len(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_writing_the_same_page_waits_and_links_to_the_first_copy(pool: PgPool) {
    let team = Uuid::now_v7();
    let ana = teammate(&pool, "first-ana", team).await;
    let bo = teammate(&pool, "second-bo", team).await;
    let repo = PgImportRepo::new(pool.clone());
    // Ana claimed the Wiki and is writing it in a live process.
    let (_, anas) = approved(&pool, &ana, &[planned_page('a', "Wiki", true)]).await;
    repo.start_run(&ana, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        &ana,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.take_run(
        &ana,
        Uuid::now_v7(),
        LEASE,
        &NotionJob::Plan {
            scope: import_notion::domain::model::ImportScope::Everything,
            sharing: NotionSharing::Team,
        },
    )
    .await
    .unwrap();
    repo.claim_importing(&ana, &anas, &anas, Some(team))
        .await
        .unwrap();
    // Bo approves the same page, shared, while Ana is still writing.
    let (review, bos) = approved(&pool, &bo, &[planned_page('a', "Wiki", true)]).await;
    planned(&repo, &bo).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer::default());
    let service = ImportServiceImpl::new(
        PgImportRepo::new(pool.clone()),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service
        .start_notion_write(&bo, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    assert!(
        writer.documents.lock().unwrap().is_empty(),
        "Bo writes no second copy"
    );
    let waiting = repo.get(&bo, bos[0]).await.unwrap().unwrap();
    assert_eq!(waiting.status, ImportStatus::Importing);
    assert_eq!(waiting.waiting_on, Some(anas[0]));
    let report = service.notion_import_report(&bo).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Completed));
    assert_eq!(report.waiting_on_teammates, 1);

    // Ana finishes: Bo's row links to her copy.
    let wiki = write::document_id(anas[0]).to_string();
    repo.mark_imported(&ana, anas[0], &wiki, "md", None)
        .await
        .unwrap();
    let linked = repo.get(&bo, bos[0]).await.unwrap().unwrap();
    assert_eq!(linked.status, ImportStatus::Imported);
    assert_eq!(linked.entity_id, Some(wiki));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_page_a_teammate_already_shared_is_linked_without_writing(pool: PgPool) {
    let team = Uuid::now_v7();
    let ana = teammate(&pool, "done-ana", team).await;
    let bo = teammate(&pool, "linking-bo", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let (_, anas) = approved(&pool, &ana, &[planned_page('a', "Wiki", true)]).await;
    repo.claim_importing(&ana, &anas, &anas, Some(team))
        .await
        .unwrap();
    repo.mark_imported(&ana, anas[0], "doc-wiki", "md", None)
        .await
        .unwrap();
    // Bo planned the Wiki privately: the team's copy still stands in for it.
    let (review, bos) = approved(&pool, &bo, &[planned_page('a', "Wiki", false)]).await;
    let row = repo.get(&bo, bos[0]).await.unwrap().unwrap();
    let mut meta: NotionDocMeta = serde_json::from_value(row.metadata).unwrap();
    meta.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "done-ana@example.com".to_string(),
            entity_id: "doc-wiki".to_string(),
            entity_type: "md".to_string(),
        });
    sqlx::query!(
        "UPDATE import_entity SET metadata = $2 WHERE id = $1",
        bos[0],
        serde_json::to_value(meta).unwrap(),
    )
    .execute(&pool)
    .await
    .unwrap();
    planned(&repo, &bo).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer::default());
    let service = ImportServiceImpl::new(
        PgImportRepo::new(pool.clone()),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service
        .start_notion_write(&bo, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    assert!(writer.documents.lock().unwrap().is_empty());
    let linked = repo.get(&bo, bos[0]).await.unwrap().unwrap();
    assert_eq!(linked.status, ImportStatus::Imported);
    assert_eq!(linked.entity_id.as_deref(), Some("doc-wiki"));
    assert_eq!(linked.team_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_plan_presented_while_planning_fills_in_batch_by_batch_and_restages_on_resume(
    pool: PgPool,
) {
    use crate::domain::service::notion_workspace::plan::PlanTree;
    use crate::domain::service::notion_workspace::triage::Verdict;
    use import_notion::domain::model::{Inventory, NotionParent};

    let owner = user("filling");
    let service = service(
        &pool,
        Writer::default(),
        tokio_util::sync::CancellationToken::new(),
        TaskTracker::new(),
    );
    let repo = PgImportRepo::new(pool.clone());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    assert!(
        service
            .take_run(
                &owner,
                &NotionJob::Plan {
                    scope: import_notion::domain::model::ImportScope::Everything,
                    sharing: NotionSharing::Personal,
                },
            )
            .await
            .unwrap()
    );
    // The agent presents the plan before planning has staged anything.
    let (review, _) = approved(&pool, &owner, &[]).await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Running));
    assert_eq!(report.review_id, Some(review));

    let page = |hex: char, title: &str, parent: NotionParent| NotionPage {
        id: page_id(hex),
        title: title.to_string(),
        url: page_id(hex).url(),
        parent,
        last_edited: chrono::Utc::now(),
        created: chrono::Utc::now(),
        in_trash: false,
        properties: Default::default(),
    };
    let tree = PlanTree::new(&Inventory {
        pages: vec![
            page('a', "Engineering", NotionParent::Workspace),
            page('b', "Spec", NotionParent::Page { id: page_id('a') }),
        ],
        data_sources: Vec::new(),
    });
    let items = tree.triage_items(&std::collections::HashMap::new());
    let verdict = |hex: char, decision: NotionDecision| {
        (
            page_id(hex).to_string(),
            Verdict {
                key: page_id(hex).to_string(),
                decision,
                reason: None,
                task_fields: None,
                shared: None,
                shared_reason: None,
            },
        )
    };
    let control = JobControl::new(tokio_util::sync::CancellationToken::new());

    // Planning: the tree is staged undecided, then one batch at a time.
    for attempt in ["first", "resumed"] {
        repo.replace_plan(
            &owner,
            ImportSource::Notion,
            &tree.staged_rows(
                NotionSharing::Personal,
                false,
                &std::collections::HashMap::new(),
            ),
        )
        .await
        .unwrap();
        let staged = service.notion_import_report(&owner).await.unwrap();
        assert_eq!(staged.review_id, Some(review), "{attempt}");
        assert_eq!((staged.pages, staged.deciding), (2, 2), "{attempt}");

        let between = Mutex::new(None);
        let batches = futures::stream::unfold(0, |batch| {
            let service = &service;
            let owner = &owner;
            let between = &between;
            async move {
                match batch {
                    0 => Some((
                        [verdict('a', NotionDecision::Copy)].into_iter().collect(),
                        1,
                    )),
                    1 => {
                        // Read once the first batch is written.
                        *between.lock().unwrap() =
                            Some(service.notion_import_report(owner).await.unwrap());
                        Some((
                            [verdict('b', NotionDecision::Skip)].into_iter().collect(),
                            2,
                        ))
                    }
                    _ => None,
                }
            }
        });
        service
            .stage_verdicts(
                &owner,
                &tree,
                &items,
                batches,
                NotionSharing::Personal,
                false,
                &control,
            )
            .await
            .unwrap();

        let between = between.into_inner().unwrap().unwrap();
        assert_eq!(
            (between.deciding, between.copy, between.skip),
            (1, 1, 0),
            "{attempt}: the first batch shows before the second is answered"
        );
        let decided = service.notion_import_report(&owner).await.unwrap();
        assert_eq!(
            (decided.pages, decided.deciding, decided.copy, decided.skip),
            (2, 0, 1, 1),
            "{attempt}"
        );
        let rows = repo
            .list(&owner, Some(ImportSource::Notion), None)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2, "{attempt}: staging again duplicates nothing");
        assert!(
            rows.iter().all(|row| row.review_id == Some(review)),
            "{attempt}: rows staged after the review was presented are tied to it"
        );
    }
}

/// The session events the import produces, in order.
#[derive(Default)]
struct Sessions(Mutex<Vec<PendingNotification>>);

impl NotificationWriter<PgConnection> for Sessions {
    fn produce<'a>(
        &'a self,
        _: &'a mut PgConnection,
        notification: &'a PendingNotification,
    ) -> NotificationFuture<'a, ()> {
        self.0.lock().unwrap().push(notification.clone());
        Box::pin(async { Ok(()) })
    }
}

/// A repository telling `sessions` what becomes of reviewed runs.
fn notifying_repo(pool: &PgPool, sessions: &Arc<Sessions>) -> PgImportRepo {
    PgImportRepo::new(pool.clone()).with_session_notifications(Arc::clone(sessions) as _)
}

/// A user with a two-page plan presented in a session while it was being
/// planned, and the run still `running`.
async fn presented_while_planning(
    pool: &PgPool,
    owner: &MacroUserIdStr<'static>,
) -> (Uuid, AgentSessionId, Vec<Uuid>) {
    let (review, rows) = approved_plan(pool, owner).await;
    let session = sqlx::query_scalar!(
        "SELECT agent_session_id FROM agent_session_review WHERE id = $1",
        review
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let session = AgentSessionId::new_from_uuid(session);
    let repo = PgImportRepo::new(pool.clone());
    repo.start_run(owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.attach_review(owner, ImportSource::Notion, review, session)
        .await
        .unwrap();
    (review, session, rows)
}

fn settled_import(
    notification: &PendingNotification,
) -> &agent_runtime_protocol::domain::notification::ImportSettlement {
    match &notification.notification.event {
        NotificationEvent::ReviewSettled(ReviewSettlement::Import { import }) => import,
        other => panic!("expected a settled import, got {other:?}"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_plan_presented_while_planning_tells_its_session_once_it_is_ready(pool: PgPool) {
    let owner = user("planned");
    let (review, session, _) = presented_while_planning(&pool, &owner).await;
    let sessions = Arc::new(Sessions::default());
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        Arc::new(NoConnector),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected));

    assert!(
        service
            .end_plan(&owner, RunStatus::Ready, None)
            .await
            .unwrap()
    );
    assert!(
        !service
            .end_plan(&owner, RunStatus::Ready, None)
            .await
            .unwrap(),
        "a plan is ready once"
    );

    let produced = sessions.0.lock().unwrap();
    assert_eq!(produced.len(), 1);
    assert_eq!(produced[0].session_id, session);
    assert_eq!(produced[0].notification.subject_id, review.to_string());
    assert!(produced[0].wake);
    let NotificationEvent::ImportPlanned(plan) = &produced[0].notification.event else {
        panic!("expected a ready plan");
    };
    assert_eq!(plan.copy, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_plan_that_fails_tells_no_session_it_is_ready(pool: PgPool) {
    let owner = user("plan-failed");
    presented_while_planning(&pool, &owner).await;
    let sessions = Arc::new(Sessions::default());
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        Arc::new(NoConnector),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );

    assert!(
        service
            .end_plan(&owner, RunStatus::Failed, Some("Notion was unreachable"))
            .await
            .unwrap()
    );

    assert!(sessions.0.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_write_tells_its_session_once_with_the_final_report(pool: PgPool) {
    let owner = user("settled");
    let (review, session, _) = presented_while_planning(&pool, &owner).await;
    let repo = PgImportRepo::new(pool.clone());
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Ready,
        None,
    )
    .await
    .unwrap();
    let sessions = Arc::new(Sessions::default());
    let tracker = TaskTracker::new();
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        Arc::new(NoConnector),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    service.notion_import_report(&owner).await.unwrap();

    let produced = sessions.0.lock().unwrap();
    assert_eq!(produced.len(), 1, "{produced:?}");
    assert_eq!(produced[0].session_id, session);
    assert_eq!(produced[0].notification.subject_id, review.to_string());
    assert!(produced[0].wake);
    let settled = settled_import(&produced[0]);
    assert_eq!(settled.outcome, ImportOutcome::Completed);
    assert_eq!(settled.error, None);
    assert_eq!(settled.imported, 2);
    assert_eq!(settled.planned, 2);
    assert_eq!(settled.not_written, 0);
    assert!(settled.root_folder_id.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_adopted_write_tells_its_session_once_when_it_finishes(pool: PgPool) {
    let owner = user("adopted-settled");
    let (review, session, rows) = presented_while_planning(&pool, &owner).await;
    let repo = PgImportRepo::new(pool.clone());
    // The first process started writing and died; its lease has lapsed.
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.take_run(
        &owner,
        Uuid::now_v7(),
        std::time::Duration::ZERO,
        &NotionJob::Write { review_id: review },
    )
    .await
    .unwrap();
    repo.mark_importing(&owner, &rows).await.unwrap();
    let sessions = Arc::new(Sessions::default());
    let tracker = TaskTracker::new();
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        Arc::new(NoConnector),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service.notion_import_report(&owner).await.unwrap();
    tracker.close();
    tracker.wait().await;
    service.notion_import_report(&owner).await.unwrap();

    let produced = sessions.0.lock().unwrap();
    assert_eq!(produced.len(), 1, "{produced:?}");
    assert_eq!(produced[0].session_id, session);
    let settled = settled_import(&produced[0]);
    assert_eq!(settled.outcome, ImportOutcome::Completed);
    assert_eq!(settled.imported, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_write_given_up_on_tells_its_session_it_failed(pool: PgPool) {
    let owner = user("given-up-settled");
    let (review, session, rows) = presented_while_planning(&pool, &owner).await;
    let repo = PgImportRepo::new(pool.clone());
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.take_run(
        &owner,
        Uuid::now_v7(),
        std::time::Duration::ZERO,
        &NotionJob::Write { review_id: review },
    )
    .await
    .unwrap();
    repo.mark_importing(&owner, &rows).await.unwrap();
    sqlx::query!(
        "UPDATE import_run SET adoptions = $2 WHERE user_id = $1",
        owner.as_ref(),
        i16::try_from(MAX_ADOPTIONS).unwrap(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let sessions = Arc::new(Sessions::default());
    let tracker = TaskTracker::new();
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        Arc::new(NoConnector),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service.notion_import_report(&owner).await.unwrap();
    tracker.close();
    tracker.wait().await;
    service.notion_import_report(&owner).await.unwrap();

    let produced = sessions.0.lock().unwrap();
    assert_eq!(produced.len(), 1, "{produced:?}");
    assert_eq!(produced[0].session_id, session);
    let settled = settled_import(&produced[0]);
    assert_eq!(settled.outcome, ImportOutcome::Failed);
    assert_eq!(settled.error.as_deref(), Some(IMPORT_STOPPED));
    assert_eq!(settled.imported, 0);
    assert_eq!(settled.not_written, 2);
}
