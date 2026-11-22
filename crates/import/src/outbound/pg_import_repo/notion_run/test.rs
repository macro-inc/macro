use std::time::Duration;

use import_notion::domain::model::{ImportScope, NotionId};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;

use super::*;
use crate::domain::models::{ImportKind, ImportSource, ImportStatus};
use crate::domain::ports::{ImportRepo, NotionPlanRepo, PlanRow};

fn user(label: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{label}@example.com"))
        .unwrap()
        .into_owned()
}

const LEASE: Duration = Duration::from_secs(90);
const STALE: Duration = Duration::from_secs(270);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_is_held_renewed_and_released_by_its_owner_only(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let alice = user("lease-owner");
    let owner = Uuid::now_v7();
    let other = Uuid::now_v7();
    let job = NotionJob::Plan {
        sharing: NotionSharing::Ai,
        scope: ImportScope::Everything,
    };

    assert!(
        !repo.take_run(&alice, owner, LEASE, &job).await.unwrap(),
        "no run to take yet"
    );
    repo.start_run(&alice, ImportSource::Notion, &[])
        .await
        .unwrap();
    assert!(repo.take_run(&alice, owner, LEASE, &job).await.unwrap());
    assert!(
        !repo.take_run(&alice, other, LEASE, &job).await.unwrap(),
        "a held run is not taken again"
    );
    assert!(repo.renew_lease(&alice, owner, LEASE).await.unwrap());
    assert!(!repo.renew_lease(&alice, other, LEASE).await.unwrap());
    assert!(
        repo.adopt_stalled_runs(Some(&alice), other, LEASE, STALE, 10)
            .await
            .unwrap()
            .is_empty(),
        "a live lease is never adopted"
    );

    assert!(!repo.release_lease(&alice, other).await.unwrap());
    assert!(repo.release_lease(&alice, owner).await.unwrap());
    assert!(
        !repo.renew_lease(&alice, owner, LEASE).await.unwrap(),
        "a released lease is gone"
    );
    let adopted = repo
        .adopt_stalled_runs(Some(&alice), other, LEASE, STALE, 10)
        .await
        .unwrap();
    assert_eq!(
        adopted,
        [AdoptedRun {
            user: alice.clone(),
            status: RunStatus::Running,
            job: Some(job),
            adoptions: 1,
        }],
        "a released run is adopted at once, with its job"
    );
    assert!(repo.renew_lease(&alice, other, LEASE).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_lease_is_adopted_once_and_a_finished_run_never(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let alice = user("lease-expired");
    let bob = user("lease-finished");
    let dead = Uuid::now_v7();
    let review_id = review(&pool, &alice).await;
    for owner in [&alice, &bob] {
        repo.start_run(owner, ImportSource::Notion, &[])
            .await
            .unwrap();
        repo.transition_run(
            owner,
            ImportSource::Notion,
            &[RunStatus::Running],
            RunStatus::Importing,
            None,
        )
        .await
        .unwrap();
    }
    // A lease of zero has lapsed by the next statement: the process died.
    assert!(
        repo.take_run(
            &alice,
            dead,
            Duration::ZERO,
            &NotionJob::Write { review_id }
        )
        .await
        .unwrap()
    );
    repo.take_run(&bob, dead, Duration::ZERO, &NotionJob::Write { review_id })
        .await
        .unwrap();
    repo.transition_run(
        &bob,
        ImportSource::Notion,
        &[RunStatus::Importing],
        RunStatus::Completed,
        None,
    )
    .await
    .unwrap();

    let first = Uuid::now_v7();
    let adopted = repo
        .adopt_stalled_runs(None, first, LEASE, STALE, 10)
        .await
        .unwrap();
    let mine: Vec<&AdoptedRun> = adopted
        .iter()
        .filter(|run| run.user == alice || run.user == bob)
        .collect();
    assert_eq!(mine.len(), 1, "only the stalled run: {adopted:?}");
    assert_eq!(mine[0].user, alice);
    assert_eq!(mine[0].status, RunStatus::Importing);
    assert_eq!(mine[0].job, Some(NotionJob::Write { review_id }));
    assert!(
        repo.adopt_stalled_runs(Some(&alice), Uuid::now_v7(), LEASE, STALE, 10)
            .await
            .unwrap()
            .is_empty(),
        "the adopter holds it now"
    );
    assert!(
        !repo.renew_lease(&alice, dead, LEASE).await.unwrap(),
        "the dead owner lost it"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_adopters_split_stalled_runs_without_overlap(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let dead = Uuid::now_v7();
    let users: Vec<MacroUserIdStr<'static>> = (0..6)
        .map(|index| user(&format!("lease-many-{index}")))
        .collect();
    for owner in &users {
        repo.start_run(owner, ImportSource::Notion, &[])
            .await
            .unwrap();
        repo.take_run(
            owner,
            dead,
            Duration::ZERO,
            &NotionJob::Plan {
                sharing: NotionSharing::Ai,
                scope: ImportScope::Everything,
            },
        )
        .await
        .unwrap();
    }

    let (left, right) = tokio::join!(
        repo.adopt_stalled_runs(None, Uuid::now_v7(), LEASE, STALE, 6),
        repo.adopt_stalled_runs(None, Uuid::now_v7(), LEASE, STALE, 6),
    );
    let mut adopted: Vec<String> = left
        .unwrap()
        .into_iter()
        .chain(right.unwrap())
        .map(|run| run.user.as_ref().to_string())
        .filter(|adopted| users.iter().any(|owner| owner.as_ref() == adopted))
        .collect();
    adopted.sort();
    let mut expected: Vec<String> = users
        .iter()
        .map(|owner| owner.as_ref().to_string())
        .collect();
    expected.sort();
    assert_eq!(adopted, expected, "every run adopted exactly once");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unleased_run_from_older_code_is_adopted_only_once_it_goes_quiet(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let alice = user("lease-legacy");
    repo.start_run(&alice, ImportSource::Notion, &[])
        .await
        .unwrap();
    assert!(
        repo.adopt_stalled_runs(Some(&alice), Uuid::now_v7(), LEASE, STALE, 1)
            .await
            .unwrap()
            .is_empty(),
        "its old heartbeat is still fresh"
    );
    sqlx::query!(
        "UPDATE import_run SET updated_at = NOW() - interval '10 minutes' WHERE user_id = $1",
        alice.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let adopted = repo
        .adopt_stalled_runs(Some(&alice), Uuid::now_v7(), LEASE, STALE, 1)
        .await
        .unwrap();
    assert_eq!(adopted.len(), 1);
    assert_eq!(adopted[0].job, None, "no job was recorded");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn written_objects_keep_their_first_record_and_stay_with_their_owner(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let alice = user("written-owner");
    let mallory = user("written-other");
    let staged = repo
        .replace_plan(
            &alice,
            ImportSource::Notion,
            &[PlanRow {
                kind: ImportKind::DataSource,
                foreign_id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee".to_string(),
                parent_foreign_id: None,
                metadata: serde_json::json!({ "title": "Bugs", "url": null, "summary": null }),
            }],
        )
        .await
        .unwrap();
    let row = staged[0].id;
    let notion_row = NotionId::parse("11111111111111111111111111111111").unwrap();
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();

    let recorded = repo
        .record_written(
            &alice,
            &[
                WrittenObject::own(row, WrittenKind::Database, first),
                WrittenObject::for_row(row, WrittenKind::Row, &notion_row, first),
            ],
        )
        .await
        .unwrap();
    assert_eq!(recorded.len(), 2);
    let again = repo
        .record_written(
            &alice,
            &[WrittenObject::own(row, WrittenKind::Database, second)],
        )
        .await
        .unwrap();
    assert_eq!(
        again,
        [WrittenObject::own(row, WrittenKind::Database, first)],
        "the earlier record wins"
    );
    assert!(
        repo.record_written(
            &mallory,
            &[WrittenObject::own(row, WrittenKind::Folder, second)]
        )
        .await
        .unwrap()
        .is_empty(),
        "nobody records against another user's row"
    );
    assert!(repo.written(&mallory, &[row]).await.unwrap().is_empty());
    let mut written = repo.written(&alice, &[row]).await.unwrap();
    written.sort_by_key(|object| object.kind.as_ref().to_string());
    assert_eq!(
        written,
        [
            WrittenObject::own(row, WrittenKind::Database, first),
            WrittenObject::for_row(row, WrittenKind::Row, &notion_row, first),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_a_stopped_write_left_claimed_are_settled_only_once_no_write_runs(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let alice = user("settle-owner");
    let staged = repo
        .replace_plan(
            &alice,
            ImportSource::Notion,
            &[PlanRow {
                kind: ImportKind::Page,
                foreign_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
                parent_foreign_id: None,
                metadata: serde_json::json!({
                    "title": "Roadmap", "url": null, "summary": null,
                    "plan": { "decision": "copy", "path": [] }
                }),
            }],
        )
        .await
        .unwrap();
    repo.mark_importing(&alice, &[staged[0].id]).await.unwrap();
    repo.start_run(&alice, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        &alice,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();

    assert_eq!(repo.settle_importing(&alice, "stopped").await.unwrap(), 0);
    repo.transition_run(
        &alice,
        ImportSource::Notion,
        &[RunStatus::Importing],
        RunStatus::Failed,
        None,
    )
    .await
    .unwrap();
    assert_eq!(repo.settle_importing(&alice, "stopped").await.unwrap(), 1);
    let row = repo.get(&alice, staged[0].id).await.unwrap().unwrap();
    assert_eq!(row.status, ImportStatus::Staged);
    assert_eq!(row.last_error.as_deref(), Some("stopped"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_root_folder_outlives_the_run_that_made_it(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let alice = user("root-folder");
    repo.start_run(&alice, ImportSource::Notion, &[])
        .await
        .unwrap();
    assert_eq!(repo.root_folder(&alice).await.unwrap(), None);
    let folder = Uuid::now_v7();
    repo.set_root_folder(&alice, folder).await.unwrap();
    repo.transition_run(
        &alice,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Ready,
        None,
    )
    .await
    .unwrap();
    repo.start_run(&alice, ImportSource::Notion, &[RunStatus::Ready])
        .await
        .unwrap();
    assert_eq!(repo.root_folder(&alice).await.unwrap(), Some(folder));
}

async fn review(pool: &PgPool, owner: &MacroUserIdStr<'static>) -> Uuid {
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
    review
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reviewed_run_reports_its_review_and_a_cancel_survives_the_write_ending(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let alice = user("reviewed-run");
    let review = review(&pool, &alice).await;
    let session = sqlx::query_scalar!(
        "SELECT agent_session_id FROM agent_session_review WHERE id = $1",
        review
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    repo.start_run(&alice, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.attach_review(
        &alice,
        ImportSource::Notion,
        review,
        AgentSessionId::new_from_uuid(session),
    )
    .await
    .unwrap();
    let runs = repo.list_runs(&alice).await.unwrap();
    assert_eq!(runs[0].review_id, Some(review));
    assert_eq!(runs[0].review_session_id, Some(session));
    let to_importing = repo
        .transition_reviewed_run(
            &alice,
            &[RunStatus::Running],
            RunStatus::Importing,
            None,
            None,
            |_| None,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        to_importing.review,
        Some(RunReview {
            review_id: review,
            session_id: AgentSessionId::new_from_uuid(session),
        })
    );
    // The owner cancels from another process while the write runs.
    repo.transition_run(
        &alice,
        ImportSource::Notion,
        &[RunStatus::Importing],
        RunStatus::Dismissed,
        Some("Cancelled"),
    )
    .await
    .unwrap();

    let mut seen = None;
    let ended = repo
        .transition_reviewed_run(
            &alice,
            &[RunStatus::Importing, RunStatus::Dismissed],
            RunStatus::Completed,
            None,
            None,
            |run| {
                seen = Some(run.status);
                None
            },
        )
        .await
        .unwrap()
        .unwrap();

    assert_eq!(seen, Some(RunStatus::Dismissed));
    assert_eq!(ended.status, RunStatus::Dismissed);
    assert_eq!(ended.error.as_deref(), Some("Cancelled"));
    assert!(
        repo.transition_reviewed_run(
            &alice,
            &[RunStatus::Importing],
            RunStatus::Completed,
            None,
            None,
            |_| None
        )
        .await
        .unwrap()
        .is_none(),
        "a run in none of `from` does not move"
    );

    sqlx::query!("DELETE FROM agent_session WHERE id = $1", session)
        .execute(&pool)
        .await
        .unwrap();
    let orphaned = repo
        .transition_reviewed_run(
            &alice,
            &[RunStatus::Dismissed],
            RunStatus::Dismissed,
            None,
            None,
            |_| None,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        orphaned.review, None,
        "a deleted session no longer hears of the run"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn workspace_sources_have_independent_leases_roots_and_adoption(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let owner = user("multi-source");
    let holder = Uuid::now_v7();
    let linear = repo.for_source(ImportSource::Linear);
    let jira = repo.for_source(ImportSource::Jira);
    for source in [
        ImportSource::Notion,
        ImportSource::Linear,
        ImportSource::Jira,
    ] {
        repo.start_run(&owner, source, &[]).await.unwrap();
    }
    let job = NotionJob::TrackerPlan {
        sharing: NotionSharing::Personal,
    };
    assert!(linear.take_run(&owner, holder, LEASE, &job).await.unwrap());
    assert!(jira.take_run(&owner, holder, LEASE, &job).await.unwrap());
    let root = Uuid::now_v7();
    linear.set_root_folder(&owner, root).await.unwrap();
    assert_eq!(jira.root_folder(&owner).await.unwrap(), None);
    assert!(linear.release_lease(&owner, holder).await.unwrap());
    assert!(jira.renew_lease(&owner, holder, LEASE).await.unwrap());
    assert!(
        jira.adopt_stalled_runs(Some(&owner), Uuid::now_v7(), LEASE, STALE, 10)
            .await
            .unwrap()
            .is_empty()
    );
    let adopted = linear
        .adopt_stalled_runs(Some(&owner), Uuid::now_v7(), LEASE, STALE, 10)
        .await
        .unwrap();
    assert_eq!(adopted.len(), 1);
    assert_eq!(adopted[0].job, Some(job));
    assert_eq!(repo.root_folder(&owner).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_mirror_updates_require_an_existing_run(pool: PgPool) {
    let repo = PgImportRepo::new(pool);
    let owner = user("missing-mirror-run");
    assert!(
        repo.set_personal_root_folder(&owner, Uuid::now_v7())
            .await
            .is_err()
    );
    assert!(
        repo.set_personal_folder(&owner, &["Notes".into()], Uuid::now_v7())
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn folder_report_updates_validate_the_target_items_owner(pool: PgPool) {
    use crate::domain::models::Initiator;
    let repo = PgImportRepo::new(pool);
    let owner = user("folder-report-owner");
    let other = user("folder-report-other");
    let metadata = serde_json::json!({"title":"Private item"});
    let row = repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::Page,
            Initiator::Manual,
            &"e".repeat(32),
            &metadata,
        )
        .await
        .unwrap()
        .unwrap();
    let folder = Uuid::now_v7();
    assert!(
        repo.set_shared_folder(&other, row.id, folder)
            .await
            .is_err()
    );
    assert!(repo.written(&owner, &[row.id]).await.unwrap().is_empty());
    assert!(
        repo.record_personal_relocation(&other, row.id, folder)
            .await
            .is_err()
    );
    assert!(
        repo.record_separate_folder(
            &other,
            row.id,
            folder,
            crate::domain::ports::FolderSeparation::SharedFromPersonal
        )
        .await
        .is_err()
    );
    assert!(
        repo.record_task_notice(
            &other,
            row.id,
            folder,
            crate::domain::ports::TaskImportNoticeReason::PersonalAssigneeOmitted
        )
        .await
        .is_err()
    );
    assert_eq!(
        repo.get(&owner, row.id).await.unwrap().unwrap().metadata,
        metadata
    );
    repo.set_shared_folder(&owner, row.id, folder)
        .await
        .unwrap();
    assert_eq!(
        repo.written(&owner, &[row.id]).await.unwrap()[0].macro_id,
        folder
    );
    repo.record_personal_relocation(&owner, row.id, folder)
        .await
        .unwrap();
    repo.record_separate_folder(
        &owner,
        row.id,
        folder,
        crate::domain::ports::FolderSeparation::SharedFromPersonal,
    )
    .await
    .unwrap();
    let saved = repo.get(&owner, row.id).await.unwrap().unwrap();
    assert_eq!(saved.metadata["personalFolderId"], folder.to_string());
    assert_eq!(
        saved.metadata["separateFolder"]["folderId"],
        folder.to_string()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn restaging_keeps_folder_report_fields(pool: PgPool) {
    use crate::domain::models::Initiator;
    let repo = PgImportRepo::new(pool);
    let owner = user("restaged-report");
    let folder = Uuid::now_v7();
    let first = serde_json::json!({"title":"Old", "personalFolderId":folder, "separateFolder":{"visibility":"shared","reason":"sharing_removed","folderId":folder}});
    repo.upsert_staged(
        &owner,
        ImportSource::Notion,
        ImportKind::Page,
        Initiator::Manual,
        &"a".repeat(32),
        &first,
    )
    .await
    .unwrap()
    .unwrap();
    let next = repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::Page,
            Initiator::Manual,
            &"a".repeat(32),
            &serde_json::json!({"title":"New"}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(next.metadata["title"], "New");
    assert_eq!(next.metadata["personalFolderId"], first["personalFolderId"]);
    assert_eq!(next.metadata["separateFolder"], first["separateFolder"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn task_notices_are_deduplicated_owned_and_do_not_rewrite_source_metadata(pool: PgPool) {
    use crate::domain::{models::Initiator, ports::TaskImportNoticeReason};
    let repo = PgImportRepo::new(pool.clone());
    let owner = user("notice-owner");
    let other = user("notice-other");
    let metadata = serde_json::json!({"title":"Tasks"});
    let first = repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            "first",
            &metadata,
        )
        .await
        .unwrap()
        .unwrap();
    let second = repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            "second",
            &metadata,
        )
        .await
        .unwrap()
        .unwrap();
    let task = Uuid::now_v7();
    for _ in 0..2 {
        repo.record_task_notice(
            &owner,
            first.id,
            task,
            TaskImportNoticeReason::PersonalAssigneeOmitted,
        )
        .await
        .unwrap();
    }
    repo.record_task_notice(
        &owner,
        second.id,
        Uuid::now_v7(),
        TaskImportNoticeReason::PersonalAssigneeOmitted,
    )
    .await
    .unwrap();
    let reordered =
        format!("{{ \"reason\": \"personal_assignee_omitted\", \"task_id\": \"{task}\" }}");
    sqlx::query!("INSERT INTO import_entity_written (import_id,kind,object,macro_id) VALUES ($1,'task_notice',$2,$3)",first.id,reordered,task).execute(&pool).await.unwrap();
    assert_eq!(
        repo.get(&owner, first.id).await.unwrap().unwrap().metadata,
        metadata
    );
    let counts = repo
        .task_notice_counts(&owner, &[first.id, first.id])
        .await
        .unwrap();
    assert_eq!(counts.len(), 1);
    assert_eq!(counts[0].count, 1);
    assert!(
        repo.task_notice_counts(&other, &[first.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(repo.clear_task_notices(&other, first.id).await.is_err());
    repo.clear_task_notices(&owner, first.id).await.unwrap();
    assert!(
        repo.task_notice_counts(&owner, &[first.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        repo.task_notice_counts(&owner, &[second.id]).await.unwrap()[0].count,
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn malformed_task_notice_payloads_fail_loudly(pool: PgPool) {
    use crate::domain::models::Initiator;
    let repo = PgImportRepo::new(pool.clone());
    let owner = user("bad-notice-owner");
    let row = repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            "tasks",
            &serde_json::json!({"title":"Tasks"}),
        )
        .await
        .unwrap()
        .unwrap();
    let task = Uuid::now_v7();
    for payload in [
        serde_json::json!({"task_id":task,"reason":"unknown"}).to_string(),
        serde_json::json!({"task_id":task}).to_string(),
        serde_json::json!({"task_id":Uuid::now_v7(),"reason":"personal_assignee_omitted"})
            .to_string(),
        serde_json::json!({"task_id":task,"reason":"personal_assignee_omitted","extra":true})
            .to_string(),
        "not json".to_string(),
    ] {
        sqlx::query!("INSERT INTO import_entity_written (import_id,kind,object,macro_id) VALUES ($1,'task_notice',$2,$3)",row.id,payload,task).execute(&pool).await.unwrap();
        assert!(repo.task_notice_counts(&owner, &[row.id]).await.is_err());
        repo.clear_task_notices(&owner, row.id).await.unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_recreated_generation_drops_old_task_notices_and_folder_reports(pool: PgPool) {
    use crate::domain::{models::Initiator, ports::TaskImportNoticeReason};
    let repo = PgImportRepo::new(pool);
    let owner = user("renew-notices");
    let target = Uuid::now_v7().to_string();
    let folder = Uuid::now_v7();
    let metadata = serde_json::json!({"title":"Tasks","plan":{"decision":"tasks","shared":false,"shareable":true},"personalFolderId":folder,"separateFolder":{"visibility":"personal","reason":"shared_branch","folderId":folder}});
    let row = repo
        .upsert_imported(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            "tasks",
            &metadata,
            &target,
            "project",
            None,
        )
        .await
        .unwrap();
    repo.record_task_notice(
        &owner,
        row.id,
        Uuid::now_v7(),
        TaskImportNoticeReason::PersonalAssigneeOmitted,
    )
    .await
    .unwrap();
    assert!(
        repo.renew_deleted_copy(&owner, row.id, &target, None, || async { Ok(true) })
            .await
            .unwrap()
    );
    let renewed = repo
        .get_own_by_foreign_id(&owner, ImportSource::Notion, "tasks")
        .await
        .unwrap()
        .unwrap();
    assert_ne!(renewed.id, row.id);
    assert!(
        repo.task_notice_counts(&owner, &[row.id, renewed.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.written(&owner, &[row.id, renewed.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(renewed.metadata.get("personalFolderId").is_none());
    assert!(renewed.metadata.get("separateFolder").is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notice_markers_alone_do_not_retain_a_staged_generation(pool: PgPool) {
    use crate::domain::{models::Initiator, ports::TaskImportNoticeReason};
    let repo = PgImportRepo::new(pool);
    let owner = user("notice-retention");
    let plan = PlanRow {
        kind: ImportKind::DataSource,
        foreign_id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee".into(),
        parent_foreign_id: None,
        metadata: serde_json::json!({"title":"Tasks","plan":{"decision":"tasks","shared":false,"shareable":true}}),
    };
    let row = repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            &plan.foreign_id,
            &plan.metadata,
        )
        .await
        .unwrap()
        .unwrap();
    repo.record_task_notice(
        &owner,
        row.id,
        Uuid::now_v7(),
        TaskImportNoticeReason::PersonalAssigneeOmitted,
    )
    .await
    .unwrap();
    let next = repo
        .replace_plan(&owner, ImportSource::Notion, &[plan])
        .await
        .unwrap();
    assert_ne!(
        next[0].id, row.id,
        "a report notice is not a physical or resumable output"
    );
    assert!(
        repo.task_notice_counts(&owner, &[row.id, next[0].id])
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_plan_keeps_its_error_kind_until_the_next_plan(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let alice = user("failed-kind");
    repo.start_run(&alice, ImportSource::Notion, &[])
        .await
        .unwrap();

    repo.transition_reviewed_run(
        &alice,
        &[RunStatus::Running],
        RunStatus::Failed,
        Some("Notion no longer accepts Macro's connection (it was revoked or expired); reconnect Notion"),
        Some(RunErrorKind::AccessLost),
        |_| None,
    )
    .await
    .unwrap()
    .unwrap();
    let runs = repo.list_runs(&alice).await.unwrap();
    assert_eq!(runs[0].status, RunStatus::Failed);
    assert_eq!(runs[0].error_kind, Some(RunErrorKind::AccessLost));

    repo.start_run(&alice, ImportSource::Notion, &[RunStatus::Failed])
        .await
        .unwrap();
    let runs = repo.list_runs(&alice).await.unwrap();
    assert_eq!(runs[0].status, RunStatus::Running);
    assert_eq!(
        runs[0].error_kind, None,
        "a new plan starts without the old failure"
    );
}
