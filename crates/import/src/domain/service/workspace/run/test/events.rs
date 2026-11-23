use super::*;

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
        no_connections(),
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
    assert_eq!(plan.source, ImportWorkspace::Notion);
    assert_eq!(plan.copy, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_linear_plan_tells_its_session_it_came_from_linear(pool: PgPool) {
    let owner = user("linear-planned");
    let issue = PlanRow {
        kind: ImportKind::Issue,
        ..page('a', "Ship importers")
    };
    let (review, _) = approved_source(&pool, &owner, &[issue], ImportSource::Linear).await;
    let session = sqlx::query_scalar!(
        "SELECT agent_session_id FROM agent_session_review WHERE id = $1",
        review
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let session = AgentSessionId::new_from_uuid(session);
    let repo = PgImportRepo::new(pool.clone());
    repo.start_run(&owner, ImportSource::Linear, &[])
        .await
        .unwrap();
    repo.attach_review(&owner, ImportSource::Linear, review, session)
        .await
        .unwrap();
    let sessions = Arc::new(Sessions::default());
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        no_connections(),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .scoped(ImportSource::Linear);

    assert!(
        service
            .end_plan(&owner, RunStatus::Ready, None)
            .await
            .unwrap()
    );

    let produced = sessions.0.lock().unwrap();
    assert_eq!(produced.len(), 1, "{produced:?}");
    assert_eq!(produced[0].session_id, session);
    let NotificationEvent::ImportPlanned(plan) = &produced[0].notification.event else {
        panic!("expected a ready plan");
    };
    assert_eq!(plan.source, ImportWorkspace::Linear);
    assert_eq!(plan.task_lists, 1, "the issue becomes a task");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_plan_that_fails_tells_no_session_it_is_ready(pool: PgPool) {
    let owner = user("plan-failed");
    let (review, _, _) = presented_while_planning(&pool, &owner).await;
    let sessions = Arc::new(Sessions::default());
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        no_connections(),
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
    let report = service.current_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Failed));
    assert_eq!(report.review_id, Some(review));
    assert!(report.confirmed.is_none());
    assert_eq!(report.imported, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancellation_preserves_partial_rows_and_marks_sampled_settlement(pool: PgPool) {
    use crate::domain::models::{FidelityWarning, WrittenKind, WrittenObject};
    use agent_runtime_protocol::domain::notification::MAX_IMPORT_ITEMS;

    let owner = user("cancelled-database");
    let sessions = Arc::new(Sessions::default());
    let repo = notifying_repo(&pool, &sessions);
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut source = planned_page('c', "Projects", false);
    source.kind = ImportKind::DataSource;
    source.metadata["plan"]["rows"] = serde_json::json!(99);
    let (review, rows) = approved(&pool, &owner, &[source, page('a', "Guide")]).await;
    repo.transition_run(
        &owner,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    repo.mark_importing(&owner, &rows).await.unwrap();
    let id = rows[0];
    assert!(
        repo.mark_import_failed(&owner, rows[1], "Page could not be copied")
            .await
            .unwrap()
    );
    repo.record_written(
        &owner,
        &[
            WrittenObject::own(id, WrittenKind::Database, Uuid::now_v7()),
            WrittenObject::for_row(id, WrittenKind::Row, &page_id('e'), Uuid::now_v7()),
            WrittenObject::for_row(id, WrittenKind::Row, &page_id('f'), Uuid::now_v7()),
        ],
    )
    .await
    .unwrap();
    let warnings: Vec<_> = (0..=MAX_IMPORT_ITEMS)
        .map(|index| FidelityWarning::Text(format!("Import notice {index}")))
        .collect();
    repo.record_warnings(&owner, id, &warnings).await.unwrap();
    let service = ImportServiceImpl::new(
        repo,
        no_connections(),
        Arc::new(Writer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected));

    assert!(service.cancel_notion_import(&owner).await.unwrap());
    let report = service.current_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Dismissed));
    assert_eq!(report.review_id, Some(review));
    let confirmed = report.confirmed.unwrap();
    assert_eq!(confirmed.databases, 0);
    assert_eq!(confirmed.database_rows, 2);
    assert_eq!(confirmed.partial_database_rows, 2);
    assert!(
        service
            .end_write(&owner, RunStatus::Dismissed, None)
            .await
            .unwrap()
    );

    let produced = sessions.0.lock().unwrap();
    assert_eq!(produced.len(), 1);
    let settlement = settled_import(&produced[0]);
    assert_eq!(settlement.outcome, ImportOutcome::Cancelled);
    assert_eq!(settlement.database_rows, 2);
    assert_eq!(settlement.warnings.len(), MAX_IMPORT_ITEMS);
    let payload = serde_json::to_value(settlement).unwrap();
    assert_eq!(payload["partialDatabaseRows"], 2);
    assert_eq!(payload["failureCount"], 1);
    assert_eq!(payload["detailsTruncated"], true);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_write_tells_its_session_once_with_the_final_report(pool: PgPool) {
    let owner = user("settled");
    let (review, session, rows) = presented_while_planning(&pool, &owner).await;
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
    repo.record_warnings(
        &owner,
        rows[0],
        &[
            "View filter approximated".into(),
            "Notion formula snapshot".into(),
        ],
    )
    .await
    .unwrap();
    let sessions = Arc::new(Sessions::default());
    let tracker = TaskTracker::new();
    let service = ImportServiceImpl::new(
        notifying_repo(&pool, &sessions),
        no_connections(),
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
    assert_eq!(settled.source, ImportWorkspace::Notion);
    assert_eq!(settled.outcome, ImportOutcome::Completed);
    assert_eq!(settled.error, None);
    assert_eq!(settled.imported, 2);
    assert_eq!(settled.planned, 2);
    assert_eq!(settled.not_written, 0);
    assert!(settled.root_folder_id.is_some());
    assert_eq!(settled.warnings.len(), 2);
    assert_eq!(settled.failure_count, Some(0));
    assert!(!settled.details_truncated);
    assert!(
        settled
            .warnings
            .contains(&"View filter approximated".to_string())
    );
    assert!(
        settled
            .warnings
            .contains(&"Notion formula snapshot".to_string())
    );
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
        no_connections(),
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
        no_connections(),
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
