use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn startup_push_only_changes_this_hosts_macrod_timers(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    let host = repo
        .register_host(HostRegistration {
            name: "timer-test-host".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    let id = repo.reserve(standard(1), now()).await.unwrap().id;
    for kind in ["macrod_missing", "retention_expired"] {
        sqlx::query!(
            "INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at) VALUES ($1, $2, $3)",
            id.as_uuid(),
            kind,
            now()
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let unrelated_host = HostId::new(Uuid::from_u128(99));
    repo.postpone_macrod_timers(unrelated_host, now() + Duration::minutes(3))
        .await
        .unwrap();
    assert_eq!(repo.due_timers(now(), 10).await.unwrap().len(), 2);
    repo.postpone_macrod_timers(host.id, now() + Duration::minutes(3))
        .await
        .unwrap();
    let due = repo.due_timers(now(), 10).await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].kind, TimerKind::RetentionExpired);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn release_only_returns_own_unfinished_fleet_leases(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    repo.register_host(HostRegistration {
        name: "lease-test-host".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    for number in 1..=4 {
        let id = repo.reserve(standard(number), now()).await.unwrap().id;
        repo.apply(id, Event::PaymentConfirmed, now())
            .await
            .unwrap();
    }
    let deadline = now() + Duration::minutes(10);
    let claimed = repo
        .lease_effects(EffectWorker::Fleet, 4, now(), deadline)
        .await
        .unwrap();
    assert_eq!(claimed.len(), 4);
    assert!(
        repo.lease_effects(EffectWorker::Fleet, 4, now(), deadline)
            .await
            .unwrap()
            .is_empty()
    );
    repo.retry_effect(
        claimed[1].id,
        "retry".to_owned(),
        now() + Duration::minutes(5),
    )
    .await
    .unwrap();
    repo.complete_effect(claimed[2].id).await.unwrap();
    // A stale shutdown must not give away a replacement replica's lease.
    sqlx::query!(
        "UPDATE hosted_runtime_effect SET run_after = $2 WHERE id = $1",
        claimed[3].id,
        deadline + Duration::minutes(1)
    )
    .execute(&pool)
    .await
    .unwrap();
    let ids: Vec<i64> = claimed.iter().map(|effect| effect.id).collect();
    repo.release_effects(&ids, deadline, now()).await.unwrap();
    let reclaimed = repo
        .lease_effects(EffectWorker::Fleet, 4, now(), deadline)
        .await
        .unwrap();
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].id, claimed[0].id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completion_and_boot_timer_commit_together_or_roll_back_together(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    let host = repo
        .register_host(HostRegistration {
            name: "completion-test-host".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    let id = repo.reserve(standard(1), now()).await.unwrap().id;
    repo.apply(id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    let effect = repo
        .lease_effects(EffectWorker::Fleet, 1, now(), now() + Duration::minutes(10))
        .await
        .unwrap()
        .remove(0);
    let state = repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap()
        .state;
    sqlx::query!(
        "UPDATE hosted_runtime SET state = '{}'::jsonb WHERE id = $1",
        id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.finish_effect(effect.id, Some(Event::InstanceStarted), now())
            .await
            .is_err()
    );
    let still_pending = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM hosted_runtime_effect WHERE id = $1",
        effect.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(still_pending, Some(1));
    sqlx::query!(
        "UPDATE hosted_runtime SET state = $2 WHERE id = $1",
        id.as_uuid(),
        serde_json::to_value(state).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.finish_effect(effect.id, Some(Event::InstanceStarted), now())
        .await
        .unwrap();
    assert_eq!(
        repo.get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .phase,
        Phase::Booting { host: host.id }
    );
    assert_eq!(
        repo.due_timers(now() + Duration::minutes(3), 10)
            .await
            .unwrap()
            .len(),
        1
    );
}
