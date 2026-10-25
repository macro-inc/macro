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
    let to_importing = repo
        .transition_reviewed_run(
            &alice,
            &[RunStatus::Running],
            RunStatus::Importing,
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
