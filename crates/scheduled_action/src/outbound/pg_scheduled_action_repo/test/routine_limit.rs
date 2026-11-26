use super::*;
use ai_billing::PlanTier;

const FREE: RoutineLimit = RoutineLimit::for_plan(PlanTier::Free);

async fn owned_rows(pool: &PgPool, owner: &str) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM scheduled_action WHERE owner = $1"#,
        owner,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn limit_reached(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::RoutineLimitReached(_))
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_active_create_at_the_limit_writes_nothing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = test_repo(pool.clone());
    for _ in 0..10 {
        repo.create_action(sample_action(user_owner(USER_A), "active"), Some(FREE))
            .await
            .unwrap();
    }

    let error = repo
        .create_action(sample_action(user_owner(USER_A), "eleventh"), Some(FREE))
        .await
        .unwrap_err();
    assert!(limit_reached(&error));
    assert_eq!(owned_rows(&pool, USER_A).await, 10);

    // A paused routine needs no slot, and other owners have their own.
    repo.create_action(
        ScheduledAction {
            enabled: false,
            ..sample_action(user_owner(USER_A), "paused")
        },
        None,
    )
    .await
    .unwrap();
    repo.create_action(sample_action(user_owner(USER_B), "other"), Some(FREE))
        .await
        .unwrap();
    assert_eq!(owned_rows(&pool, USER_A).await, 11);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn paused_and_finished_routines_do_not_count(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    repo.create_action(
        ScheduledAction {
            enabled: false,
            ..sample_action(user_owner(USER_A), "paused")
        },
        None,
    )
    .await
    .unwrap();
    repo.create_action(
        ScheduledAction {
            next_run_at: None,
            ..sample_action(user_owner(USER_A), "finished one-off")
        },
        None,
    )
    .await
    .unwrap();
    for _ in 0..10 {
        repo.create_action(sample_action(user_owner(USER_A), "active"), Some(FREE))
            .await
            .unwrap();
    }

    let error = repo
        .create_action(sample_action(user_owner(USER_A), "eleventh"), Some(FREE))
        .await
        .unwrap_err();
    assert!(limit_reached(&error));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_routine_counts_without_a_next_run(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    repo.create_action(event_action(), Some(FREE))
        .await
        .unwrap();
    for _ in 0..9 {
        repo.create_action(sample_action(user_owner(USER_A), "active"), Some(FREE))
            .await
            .unwrap();
    }

    let error = repo
        .create_action(sample_action(user_owner(USER_A), "eleventh"), Some(FREE))
        .await
        .unwrap_err();
    assert!(limit_reached(&error));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enabling_at_the_limit_leaves_the_routine_paused(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let paused = repo
        .create_action(
            ScheduledAction {
                enabled: false,
                ..sample_action(user_owner(USER_A), "paused")
            },
            None,
        )
        .await
        .unwrap();
    for _ in 0..10 {
        repo.create_action(sample_action(user_owner(USER_A), "active"), Some(FREE))
            .await
            .unwrap();
    }

    let enabled = ScheduledAction {
        enabled: true,
        configuration_revision: paused.configuration_revision.next().unwrap(),
        ..paused.clone()
    };
    let error = repo.update_action(enabled, Some(FREE)).await.unwrap_err();
    assert!(limit_reached(&error));
    let stored = repo.get_action(&paused.id.unwrap()).await.unwrap().unwrap();
    assert!(!stored.enabled);
    assert_eq!(stored.configuration_revision, paused.configuration_revision);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_activation_waits_for_one_in_flight_and_then_counts_it(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let paused = repo
        .create_action(
            ScheduledAction {
                enabled: false,
                ..sample_action(user_owner(USER_A), "paused")
            },
            None,
        )
        .await
        .unwrap();
    for _ in 0..9 {
        repo.create_action(sample_action(user_owner(USER_A), "active"), Some(FREE))
            .await
            .unwrap();
    }

    // Another writer is enabling the paused routine: it has taken the last
    // slot and not yet committed.
    let paused_id = paused.id.unwrap();
    let mut in_flight = pool.begin().await.unwrap();
    check_active_limit(&mut in_flight, USER_A, paused_id, FREE)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE scheduled_action SET enabled = true WHERE id = $1",
        paused_id
    )
    .execute(&mut *in_flight)
    .await
    .unwrap();

    let creating_repo = test_repo(pool.clone());
    let mut creating = tokio::spawn(async move {
        creating_repo
            .create_action(sample_action(user_owner(USER_A), "racing"), Some(FREE))
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut creating)
            .await
            .is_err()
    );
    in_flight.commit().await.unwrap();

    let error = creating.await.unwrap().unwrap_err();
    assert!(limit_reached(&error));
    assert_eq!(owned_rows(&pool, USER_A).await, 10);
}
