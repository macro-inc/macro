use super::*;
use crate::domain::service::WorkspaceImporter;
use crate::domain::service::tracker_workspace::{plan as tracker_plan, values as tracker_values};
use import_tracker::domain::model::{Group, GroupKind, Inventory, Issue, ObjectId};

fn snapshot() -> Inventory {
    Inventory {
        groups: vec![Group {
            id: ObjectId::parse("project").unwrap(),
            title: "Launch".into(),
            kind: GroupKind::Project,
            parent: None,
            url: None,
            description: None,
        }],
        issues: vec![Issue {
            id: ObjectId::parse("issue").unwrap(),
            identifier: "ENG-1".into(),
            title: "Ship".into(),
            description: "Body".into(),
            status: "Started".into(),
            status_category: "started".into(),
            issue_type: None,
            priority: None,
            assignee_email: None,
            due_date: None,
            labels: vec!["bug".into()],
            estimate: None,
            parent: None,
            group: Some(ObjectId::parse("project").unwrap()),
            team: None,
            cycle: None,
            url: "https://linear.app/issue/ENG-1".into(),
            comments: Vec::new(),
        }],
        ..Inventory::default()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_relationships_are_reported_and_retry_reuses_the_created_task(pool: PgPool) {
    let owner = teammate(&pool, "tracker-links", Uuid::now_v7()).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .scoped(ImportSource::Linear);
    service
        .creator
        .reject_tracker_links
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let repo = service.repo.clone();
    let rows =
        tracker_plan::rows(ImportSource::Linear, &snapshot(), NotionSharing::Team, true).unwrap();
    let rows = tracker_plan::decide(
        &rows,
        &std::collections::HashMap::new(),
        NotionSharing::Team,
        true,
    )
    .unwrap();
    repo.start_run(&owner, ImportSource::Linear, &[])
        .await
        .unwrap();
    let (review, _) = approved_source(&pool, &owner, &rows, ImportSource::Linear).await;
    repo.finish_run(&owner, ImportSource::Linear, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_workspace_write(
            &owner,
            ImportSource::Linear,
            review,
            NotionWriteChoices::default(),
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service
        .workspace_import_report(&owner, ImportSource::Linear)
        .await
        .unwrap();
    assert_eq!(report.failures.len(), 1);
    assert_eq!(service.creator.tracker_tasks.lock().unwrap().len(), 1);
    let created = service.creator.tracker_tasks.lock().unwrap()[0];
    assert!(service.creator.shares.lock().unwrap().is_empty());
    assert!(
        service
            .creator
            .tracker_task_sharing
            .lock()
            .unwrap()
            .iter()
            .all(|shared| !shared)
    );
    let staged = repo
        .list(
            &owner,
            Some(ImportSource::Linear),
            Some(ImportStatus::Staged),
        )
        .await
        .unwrap();
    assert_eq!(tracker_values::target_id(staged[0].id), created);

    // A new reviewed plan retains a partially written row and its stable id.
    service
        .creator
        .reject_tracker_links
        .store(false, std::sync::atomic::Ordering::SeqCst);
    repo.start_run(&owner, ImportSource::Linear, &[RunStatus::Completed])
        .await
        .unwrap();
    let (retry, _) = approved_source(&pool, &owner, &rows, ImportSource::Linear).await;
    repo.finish_run(&owner, ImportSource::Linear, RunStatus::Ready, None)
        .await
        .unwrap();
    let resumed = service
        .clone()
        .with_job_shutdown(CancellationToken::new(), TaskTracker::new());
    resumed
        .start_workspace_write(
            &owner,
            ImportSource::Linear,
            retry,
            NotionWriteChoices::default(),
        )
        .await
        .unwrap();
    resumed.jobs.tracker.close();
    resumed.jobs.tracker.wait().await;
    let report = resumed
        .workspace_import_report(&owner, ImportSource::Linear)
        .await
        .unwrap();
    assert!(report.failures.is_empty());
    assert_eq!(
        service.creator.shares.lock().unwrap().as_slice(),
        [SharedEntity::Document(created)]
    );
    assert_eq!(
        service.creator.tracker_tasks.lock().unwrap().as_slice(),
        [created]
    );
    assert_eq!(
        service.creator.tracker_links.lock().unwrap().as_slice(),
        [created]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn linking_a_teammates_copy_never_rewrites_its_relationships(pool: PgPool) {
    let team = Uuid::now_v7();
    let alice = teammate(&pool, "tracker-alice", team).await;
    let bob = teammate(&pool, "tracker-bob", team).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .scoped(ImportSource::Jira);
    let rows =
        tracker_plan::rows(ImportSource::Jira, &snapshot(), NotionSharing::Team, true).unwrap();
    let rows = tracker_plan::decide(
        &rows,
        &std::collections::HashMap::new(),
        NotionSharing::Team,
        true,
    )
    .unwrap();
    for owner in [&alice, &bob] {
        service
            .repo
            .start_run(owner, ImportSource::Jira, &[])
            .await
            .unwrap();
        let (review, _) = approved_source(&pool, owner, &rows, ImportSource::Jira).await;
        service
            .repo
            .finish_run(owner, ImportSource::Jira, RunStatus::Ready, None)
            .await
            .unwrap();
        service
            .start_workspace_write(
                owner,
                ImportSource::Jira,
                review,
                NotionWriteChoices::default(),
            )
            .await
            .unwrap();
        // Each run uses its own tracker so its completion is a real sync point.
        tracker.close();
        tracker.wait().await;
    }
    assert_eq!(service.creator.tracker_tasks.lock().unwrap().len(), 1);
    assert_eq!(service.creator.tracker_projects.lock().unwrap().len(), 1);
    assert_eq!(service.creator.tracker_links.lock().unwrap().len(), 1);
    let a = service
        .repo
        .list(
            &alice,
            Some(ImportSource::Jira),
            Some(ImportStatus::Imported),
        )
        .await
        .unwrap();
    let b = service
        .repo
        .list(&bob, Some(ImportSource::Jira), Some(ImportStatus::Imported))
        .await
        .unwrap();
    let a = a
        .iter()
        .find(|row| row.user_id == alice.as_ref() && row.kind == ImportKind::JiraIssue)
        .unwrap();
    let b = b
        .iter()
        .find(|row| row.user_id == bob.as_ref() && row.kind == ImportKind::JiraIssue)
        .unwrap();
    assert_eq!(a.entity_id, b.entity_id);
    assert_eq!(b.team_id, None);
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_projects_keep_child_relationships_retryable(pool: PgPool) {
    let owner = user("tracker-projects");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .scoped(ImportSource::Linear);
    service
        .creator
        .reject_tracker_projects
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let repo = service.repo.clone();
    let rows = tracker_plan::rows(
        ImportSource::Linear,
        &snapshot(),
        NotionSharing::Personal,
        false,
    )
    .unwrap();
    let rows = tracker_plan::decide(
        &rows,
        &std::collections::HashMap::new(),
        NotionSharing::Personal,
        false,
    )
    .unwrap();
    repo.start_run(&owner, ImportSource::Linear, &[])
        .await
        .unwrap();
    let (review, _) = approved_source(&pool, &owner, &rows, ImportSource::Linear).await;
    repo.finish_run(&owner, ImportSource::Linear, RunStatus::Ready, None)
        .await
        .unwrap();
    service
        .start_workspace_write(
            &owner,
            ImportSource::Linear,
            review,
            NotionWriteChoices::default(),
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service
        .workspace_import_report(&owner, ImportSource::Linear)
        .await
        .unwrap();
    assert_eq!(report.failures.len(), 2);
    assert_eq!(service.creator.tracker_tasks.lock().unwrap().len(), 1);
    let created = service.creator.tracker_tasks.lock().unwrap()[0];
    let staged = repo
        .list(
            &owner,
            Some(ImportSource::Linear),
            Some(ImportStatus::Staged),
        )
        .await
        .unwrap();
    let issue = staged
        .iter()
        .find(|row| row.kind == ImportKind::Issue)
        .unwrap();
    assert_eq!(tracker_values::target_id(issue.id), created);
    assert!(service.creator.tracker_links.lock().unwrap().is_empty());

    // A new reviewed plan retains a partially written row and its stable id.
    service
        .creator
        .reject_tracker_projects
        .store(false, std::sync::atomic::Ordering::SeqCst);
    repo.start_run(&owner, ImportSource::Linear, &[RunStatus::Completed])
        .await
        .unwrap();
    let (retry, _) = approved_source(&pool, &owner, &rows, ImportSource::Linear).await;
    repo.finish_run(&owner, ImportSource::Linear, RunStatus::Ready, None)
        .await
        .unwrap();
    let resumed = service
        .clone()
        .with_job_shutdown(CancellationToken::new(), TaskTracker::new());
    resumed
        .start_workspace_write(
            &owner,
            ImportSource::Linear,
            retry,
            NotionWriteChoices::default(),
        )
        .await
        .unwrap();
    resumed.jobs.tracker.close();
    resumed.jobs.tracker.wait().await;
    let report = resumed
        .workspace_import_report(&owner, ImportSource::Linear)
        .await
        .unwrap();
    assert!(report.failures.is_empty());
    assert_eq!(
        service.creator.tracker_tasks.lock().unwrap().as_slice(),
        [created]
    );
    assert_eq!(
        service.creator.tracker_links.lock().unwrap().as_slice(),
        [created]
    );
}
