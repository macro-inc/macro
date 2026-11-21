//! Tracker plans and writes must reject deleted team targets just like Notion.
use super::*;
use std::collections::HashMap;

struct IssuesOnly;
#[async_trait::async_trait]
impl import_tracker::domain::model::TrackerConnections for IssuesOnly {
    async fn inventory(
        &self,
        _: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(usize, usize) + Send + Sync),
    ) -> std::result::Result<Inventory, import_tracker::domain::model::TrackerError> {
        let mut found = snapshot();
        found.groups.clear();
        found.issues[0].group = None;
        progress(1, 0);
        Ok(found)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_linear_plan_ignores_a_trashed_teammate_task(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "linear-deleted-owner", team).await;
    let importer = teammate(&pool, "linear-deleted-importer", team).await;
    let mut found = snapshot();
    found.groups.clear();
    found.issues[0].group = None;
    let rows = tracker_plan::rows(ImportSource::Linear, &found, NotionSharing::Team, true).unwrap();
    let repo = PgImportRepo::new(pool.clone()).for_source(ImportSource::Linear);
    let staged = repo
        .replace_plan(&owner, ImportSource::Linear, &rows)
        .await
        .unwrap();
    let old = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO "Document" (id,name,owner,"fileType","deletedAt") VALUES ($1,'Old task',$2,'md',NOW())"#, old.to_string(), owner.as_ref()).execute(&pool).await.unwrap();
    repo.claim_importing(&owner, &[staged[0].id], &[staged[0].id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, staged[0].id, &old.to_string(), "task", Some(team))
        .await
        .unwrap();
    repo.start_run(&importer, ImportSource::Linear, &[])
        .await
        .unwrap();
    let service = service(
        &pool,
        Writer {
            target_pool: Some(pool.clone()),
            ..Default::default()
        },
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_tracker_connections(Arc::new(IssuesOnly), Arc::new(IssuesOnly))
    .scoped(ImportSource::Linear);
    service
        .plan_tracker(
            &importer,
            NotionSharing::Team,
            &JobControl::new(CancellationToken::new()),
        )
        .await
        .unwrap();
    let planned = repo
        .get_own_by_foreign_id(&importer, ImportSource::Linear, "issue")
        .await
        .unwrap()
        .unwrap();
    let meta: NotionDocMeta = serde_json::from_value(planned.metadata).unwrap();
    assert!(meta.plan.unwrap().already_imported.is_none());
    let owner_row = repo
        .get_own_by_foreign_id(&owner, ImportSource::Linear, "issue")
        .await
        .unwrap()
        .unwrap();
    assert_ne!(owner_row.id, staged[0].id);
    assert_eq!(owner_row.status, ImportStatus::Staged);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_jira_write_replaces_a_team_task_deleted_after_planning(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "jira-deleted-owner", team).await;
    let importer = teammate(&pool, "jira-deleted-importer", team).await;
    let mut found = snapshot();
    found.groups.clear();
    found.issues[0].group = None;
    let rows = tracker_plan::rows(ImportSource::Jira, &found, NotionSharing::Team, true).unwrap();
    let rows = tracker_plan::decide(&rows, &HashMap::new(), NotionSharing::Team, true).unwrap();
    let repo = PgImportRepo::new(pool.clone()).for_source(ImportSource::Jira);
    let owners = repo
        .replace_plan(&owner, ImportSource::Jira, &rows)
        .await
        .unwrap();
    let old = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO "Document" (id,name,owner,"fileType","deletedAt") VALUES ($1,'Old Jira task',$2,'md',NOW())"#, old.to_string(), owner.as_ref()).execute(&pool).await.unwrap();
    repo.claim_importing(&owner, &[owners[0].id], &[owners[0].id], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, owners[0].id, &old.to_string(), "task", Some(team))
        .await
        .unwrap();
    repo.start_run(&importer, ImportSource::Jira, &[])
        .await
        .unwrap();
    let (review, _) = approved_source(&pool, &importer, &rows, ImportSource::Jira).await;
    repo.finish_run(&importer, ImportSource::Jira, RunStatus::Ready, None)
        .await
        .unwrap();
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer {
            target_pool: Some(pool.clone()),
            ..Default::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .scoped(ImportSource::Jira);
    service
        .start_workspace_write(
            &importer,
            ImportSource::Jira,
            review,
            NotionWriteChoices::default(),
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert_eq!(service.creator.tracker_tasks.lock().unwrap().len(), 1);
    let row = repo
        .get_own_by_foreign_id(&importer, ImportSource::Jira, "issue")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.status, ImportStatus::Imported);
    assert_ne!(row.entity_id, Some(old.to_string()));
}
