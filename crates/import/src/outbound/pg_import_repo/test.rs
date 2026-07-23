use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|auto-import@example.com").expect("valid user id")
}

async fn ready_run(repo: &PgImportRepo, auto_import: bool) {
    assert!(
        repo.start_run(&user(), ImportSource::Linear, &[], auto_import)
            .await
            .expect("start run")
    );
    assert!(
        repo.finish_run(&user(), ImportSource::Linear, RunStatus::Ready, None)
            .await
            .expect("finish gather")
    );
}

async fn stage(
    repo: &PgImportRepo,
    source: ImportSource,
    initiator: Initiator,
    foreign_id: &str,
) -> ImportEntity {
    let metadata = match source {
        ImportSource::Linear => serde_json::json!({ "title": foreign_id }),
        ImportSource::Notion => serde_json::json!({ "title": foreign_id }),
        ImportSource::Slack => serde_json::json!({ "name": foreign_id }),
    };
    repo.upsert_staged(&user(), source, initiator, foreign_id, &metadata)
        .await
        .expect("stage query")
        .expect("staged row")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn auto_import_claims_only_its_onboarding_source(pool: Pool<Postgres>) {
    let repo = PgImportRepo::new(pool);
    ready_run(&repo, true).await;

    let claimed = stage(&repo, ImportSource::Linear, Initiator::Onboarding, "LIN-1").await;
    let chat = stage(&repo, ImportSource::Linear, Initiator::Chat, "LIN-CHAT").await;
    let notion = stage(
        &repo,
        ImportSource::Notion,
        Initiator::Onboarding,
        "NOTION-1",
    )
    .await;

    assert_eq!(
        repo.delete_staged_by_initiator(&user(), Initiator::Onboarding)
            .await
            .expect("onboarding cleanup"),
        1,
        "only the unrelated Notion row should be removed"
    );
    assert!(
        repo.get(&user(), notion.id)
            .await
            .expect("notion row lookup")
            .is_none()
    );

    let rows = repo
        .begin_auto_import(&user(), ImportSource::Linear)
        .await
        .expect("begin auto import")
        .expect("claimed run");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, claimed.id);
    assert_eq!(rows[0].status, ImportStatus::Importing);

    assert_eq!(
        repo.get(&user(), chat.id)
            .await
            .expect("chat row")
            .expect("chat row exists")
            .status,
        ImportStatus::Staged
    );
    assert!(
        repo.begin_auto_import(&user(), ImportSource::Linear)
            .await
            .expect("second begin")
            .is_none(),
        "the run claim is a CAS"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn auto_import_run_reports_completed_or_failed(pool: Pool<Postgres>) {
    let repo = PgImportRepo::new(pool);
    ready_run(&repo, true).await;
    let row = stage(&repo, ImportSource::Linear, Initiator::Onboarding, "LIN-1").await;
    let claimed = repo
        .begin_auto_import(&user(), ImportSource::Linear)
        .await
        .expect("begin")
        .expect("claimed");
    assert_eq!(claimed.len(), 1);
    repo.mark_imported(&user(), row.id, "task-1", "task", None)
        .await
        .expect("mark imported")
        .expect("updated row");

    assert_eq!(
        repo.finish_auto_import(&user(), ImportSource::Linear, &[row.id])
            .await
            .expect("finish")
            .expect("won finish"),
        RunStatus::Completed
    );
    let run = repo
        .list_runs(&user())
        .await
        .expect("runs")
        .pop()
        .expect("run");
    assert_eq!(run.status, RunStatus::Completed);
    assert!(run.auto_import);

    // A retry preserves the run's configuration and can report an item
    // failure on its next automatic batch.
    assert!(
        repo.start_run(
            &user(),
            ImportSource::Linear,
            &[RunStatus::Completed],
            false,
        )
        .await
        .expect("restart for test")
    );
    assert!(
        repo.finish_run(&user(), ImportSource::Linear, RunStatus::Ready, None)
            .await
            .expect("ready again")
    );
    let failed_row = stage(&repo, ImportSource::Linear, Initiator::Onboarding, "LIN-2").await;
    repo.begin_auto_import(&user(), ImportSource::Linear)
        .await
        .expect("begin failed batch")
        .expect("claimed failed batch");
    assert!(
        repo.mark_import_failed(&user(), failed_row.id, "creator failed")
            .await
            .expect("mark failed")
    );
    assert_eq!(
        repo.finish_auto_import(&user(), ImportSource::Linear, &[failed_row.id])
            .await
            .expect("finish failed")
            .expect("won failed finish"),
        RunStatus::Failed
    );
    assert_eq!(
        repo.delete_staged_by_initiator(&user(), Initiator::Onboarding)
            .await
            .expect("cleanup after failure"),
        0,
        "a retryable automatic-import failure must survive onboarding cleanup"
    );
    assert!(
        repo.get(&user(), failed_row.id)
            .await
            .expect("failed row lookup")
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn interrupted_auto_import_run_is_reconciled(pool: Pool<Postgres>) {
    let repo = PgImportRepo::new(pool);
    ready_run(&repo, true).await;
    let row = stage(&repo, ImportSource::Linear, Initiator::Onboarding, "LIN-1").await;
    repo.begin_auto_import(&user(), ImportSource::Linear)
        .await
        .expect("begin")
        .expect("claimed");
    assert!(
        repo.mark_import_failed(&user(), row.id, "process interrupted")
            .await
            .expect("mark interrupted")
    );

    assert_eq!(
        repo.reconcile_auto_import_runs(&user())
            .await
            .expect("reconcile"),
        1
    );
    let run = repo
        .list_runs(&user())
        .await
        .expect("runs")
        .pop()
        .expect("run");
    assert_eq!(run.status, RunStatus::Failed);
    assert_eq!(
        run.error.as_deref(),
        Some("one or more automatic imports failed")
    );
}
