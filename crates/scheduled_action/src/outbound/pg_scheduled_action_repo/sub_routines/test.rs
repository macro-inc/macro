use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::super::test::{USER_A, insert_user, sample_action, test_repo, user_owner};
use super::*;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::ExecutionResult;

const RUN: &str = "0199a000-0000-7000-8000-000000000001";

fn run() -> Uuid {
    RUN.parse().unwrap()
}

fn child_of(parent: &ScheduledAction, name: &str, key: Option<&str>) -> ScheduledAction {
    ScheduledAction {
        sub_routine: Some(SubRoutine {
            parent_id: parent.id.unwrap(),
            created_by_run_id: run(),
            key: key.map(|key| SubRoutineKey::new(key).unwrap()),
            paused_by_parent: false,
        }),
        ..sample_action(user_owner(USER_A), name)
    }
}

/// A one-time routine that already ran: nothing left to run.
fn finished_once(parent: &ScheduledAction, name: &str) -> ScheduledAction {
    ScheduledAction {
        trigger: ActionTrigger::Once {
            at: Utc.with_ymd_and_hms(2026, 1, 1, 9, 0, 0).unwrap(),
        },
        next_run_at: None,
        ..child_of(parent, name, None)
    }
}

async fn registered(pool: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM entity WHERE id = $1) AS "exists!""#,
        id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn policy(error: &anyhow::Error) -> Option<&ActionPolicyError> {
    error.downcast_ref::<ActionPolicyError>()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_cap_counts_active_sub_routines_and_not_finished_one_time_ones(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let parent = repo
        .create_action(sample_action(user_owner(USER_A), "parent"))
        .await
        .unwrap();
    for index in 0..49 {
        repo.create_action(child_of(&parent, &format!("child {index}"), None))
            .await
            .unwrap();
    }
    // Finished one-time sub-routines take no room.
    for index in 0..3 {
        repo.create_action(finished_once(&parent, &format!("done {index}")))
            .await
            .unwrap();
    }

    repo.create_action(child_of(&parent, "the fiftieth", None))
        .await
        .unwrap();
    let refused = repo
        .create_action(child_of(&parent, "one too many", None))
        .await
        .unwrap_err();

    assert!(matches!(
        policy(&refused),
        Some(ActionPolicyError::TooManySubRoutines)
    ));
    assert_eq!(repo.children(&parent.id.unwrap()).await.unwrap().len(), 53);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_parent_has_one_sub_routine_per_key(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let parent = repo
        .create_action(sample_action(user_owner(USER_A), "parent"))
        .await
        .unwrap();
    let other = repo
        .create_action(sample_action(user_owner(USER_A), "other parent"))
        .await
        .unwrap();
    let first = repo
        .create_action(child_of(&parent, "first", Some("task-1")))
        .await
        .unwrap();

    let taken = repo
        .create_action(child_of(&parent, "second", Some("task-1")))
        .await
        .unwrap_err();
    // The same key under another parent names another routine.
    repo.create_action(child_of(&other, "elsewhere", Some("task-1")))
        .await
        .unwrap();

    assert!(matches!(
        policy(&taken),
        Some(ActionPolicyError::UpdateConflict)
    ));
    let key = SubRoutineKey::new("task-1").unwrap();
    let found = repo
        .child_by_key(&parent.id.unwrap(), &key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.id, first.id);
    assert_eq!(found.sub_routine, first.sub_routine);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_parent_removes_its_sub_routines_and_their_registrations(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let parent = repo
        .create_action(sample_action(user_owner(USER_A), "parent"))
        .await
        .unwrap();
    let child = repo
        .create_action(child_of(&parent, "child", None))
        .await
        .unwrap();
    let kept = repo
        .create_action(child_of(&parent, "kept", Some("kept")))
        .await
        .unwrap();

    let detached = repo.detach(&kept.id.unwrap()).await.unwrap().unwrap();
    assert_eq!(detached.sub_routine, None);
    assert_eq!(
        repo.detach(&kept.id.unwrap()).await.unwrap().map(|a| a.id),
        None
    );

    repo.delete_action(&parent.id.unwrap()).await.unwrap();

    assert!(
        repo.get_action(&parent.id.unwrap())
            .await
            .unwrap()
            .is_none()
    );
    assert!(repo.get_action(&child.id.unwrap()).await.unwrap().is_none());
    assert!(!registered(&pool, child.id.unwrap()).await);
    let grants = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM entity_access WHERE entity_id = $1"#,
        child.id.unwrap(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(grants, 0);
    assert!(repo.get_action(&kept.id.unwrap()).await.unwrap().is_some());
    assert!(registered(&pool, kept.id.unwrap()).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_in_progress_is_found_by_its_routine_and_by_its_session(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let parent = repo
        .create_action(sample_action(user_owner(USER_A), "parent"))
        .await
        .unwrap();
    let id = parent.id.unwrap();
    assert_eq!(repo.running_run(&id).await.unwrap(), None);

    let token = repo
        .claim_action(&id, parent.configuration_revision, parent.next_run_at)
        .await
        .unwrap();
    let running = RunningRun {
        routine_id: id,
        parent_id: None,
        owner: user_owner(USER_A),
        run_id: token.as_uuid(),
    };
    assert_eq!(repo.running_run(&id).await.unwrap(), Some(running.clone()));
    assert_eq!(
        repo.running_run_of_session(&token.as_uuid()).await.unwrap(),
        Some(running)
    );

    // The run's history record takes the run's id, so what it created
    // points at it.
    let child = repo
        .create_action(ScheduledAction {
            sub_routine: Some(SubRoutine {
                parent_id: id,
                created_by_run_id: token.as_uuid(),
                key: None,
                paused_by_parent: false,
            }),
            ..sample_action(user_owner(USER_A), "child")
        })
        .await
        .unwrap();
    let now = Utc::now();
    repo.create_execution_record(ActionExecutionRecord {
        id: Some(token.as_uuid()),
        action_id: id,
        resource_id: None,
        start_time: now,
        end_time: now,
        is_success: true,
        result: serde_json::to_value(ExecutionResult::new(None, None)).unwrap(),
        created_at: now,
    })
    .await
    .unwrap();
    repo.release_action(&id, token).await.unwrap();

    assert_eq!(repo.running_run(&id).await.unwrap(), None);
    assert_eq!(
        repo.running_run_of_session(&token.as_uuid()).await.unwrap(),
        None
    );
    let records = repo.get_execution_records(&id).await.unwrap();
    let runs: Vec<Uuid> = records.iter().filter_map(|record| record.id).collect();
    assert_eq!(runs, [token.as_uuid()]);
    let created = repo.created_by_runs(&id, &runs).await.unwrap();
    assert_eq!(
        created,
        [(
            token.as_uuid(),
            CreatedRoutine {
                id: child.id.unwrap(),
                name: "child".into(),
            }
        )]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sub_routine_created_off_with_its_parent_keeps_that_mark(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let parent = repo
        .create_action(sample_action(user_owner(USER_A), "parent"))
        .await
        .unwrap();
    let mut waiting = child_of(&parent, "waits for its parent", None);
    waiting.enabled = false;
    waiting.sub_routine.as_mut().unwrap().paused_by_parent = true;

    let created = repo.create_action(waiting).await.unwrap();

    assert!(created.sub_routine.as_ref().unwrap().paused_by_parent);
    let stored = repo
        .get_action(&created.id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(!stored.enabled);
    assert!(stored.sub_routine.unwrap().paused_by_parent);
}
