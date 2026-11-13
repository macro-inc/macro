use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn corrupt_row_does_not_abort_fleet_scans(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = repo
        .register_host(HostRegistration {
            name: "quarantine-test".to_owned(),
            memory_gb: 64,
            reserve_gb: 8,
            oversell_factor: 3,
            image: crate::domain::image::GuestImage::try_new("macro-box/test").unwrap(),
        })
        .await
        .unwrap();
    for id in [101, 102] {
        let computer = bought(&repo, id).await;
        let mut state = computer.state;
        state.phase = Phase::Running;
        sqlx::query!(
            "UPDATE hosted_runtime SET state = $2, awake = true WHERE id = $1",
            computer.id.as_uuid(),
            serde_json::to_value(state).unwrap()
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO hosted_runtime_effect (computer_id, worker, effect, run_after) VALUES ($1, 'billing', '{"effect":"remove_billing_item","subscription_item":"si_quarantine"}', $2)"#,
            computer.id.as_uuid(),
            now() + Duration::minutes(1),
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let bad_id = Uuid::from_u128(102);
    sqlx::query!("UPDATE hosted_runtime SET name = '' WHERE id = $1", bad_id)
        .execute(&pool)
        .await
        .unwrap();

    let records = repo.list_for_team(TEAM).await.unwrap();
    assert_eq!(records.len(), 2);
    let healthy = records
        .iter()
        .find(|record| record.id().as_uuid() == Uuid::from_u128(101))
        .unwrap();
    assert!(matches!(
        healthy.healthy().unwrap().state.phase,
        Phase::Running
    ));
    let bad = records
        .iter()
        .find(|record| record.id().as_uuid() == bad_id)
        .unwrap();
    match bad {
        ComputerRecord::NeedsAttention {
            id,
            team_id,
            host_id,
            reason,
            ..
        } => {
            assert_eq!(id.as_uuid(), bad_id);
            assert_eq!(*team_id, Some(TEAM));
            assert_eq!(*host_id, Some(host.id));
            assert_eq!(reason.to_string(), "name must contain 1..=64 characters");
        }
        ComputerRecord::Healthy(_) => panic!("an invalid name must be quarantined"),
    }
    assert_eq!(
        bad.status(0, now(), policy()).status,
        crate::domain::models::ComputerStatusKind::NeedsAttention
    );
    assert_eq!(repo.instances_expected(host.id).await.unwrap().len(), 2);
    assert!(matches!(
        repo.get(ComputerId::new_from_uuid(bad_id)).await.unwrap(),
        Some(ComputerRecord::NeedsAttention { .. })
    ));
    let corrupt = ComputerId::new_from_uuid(bad_id);
    assert!(repo.apply(corrupt, Event::ReleaseNow, now()).await.is_err());
    let due = now() + Duration::minutes(2);
    // Quarantine stops fleet work, but billing item removals still run:
    // they only stop a charge, and the item is in the effect.
    let effects = repo
        .lease_effects(EffectWorker::Billing, 10, due, due + Duration::minutes(10))
        .await
        .unwrap();
    let mut owners: Vec<Uuid> = effects
        .iter()
        .map(|effect| effect.computer_id.as_uuid())
        .collect();
    owners.sort();
    assert_eq!(owners, vec![Uuid::from_u128(101), bad_id]);

    for id in [bad_id, Uuid::from_u128(101)] {
        let fire_at = if id == bad_id {
            now() - Duration::minutes(1)
        } else {
            now()
        };
        sqlx::query!("INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at) VALUES ($1, 'restart_due', $2)", id, fire_at).execute(&pool).await.unwrap();
    }
    let timers = repo.due_timers(due, 1).await.unwrap();
    assert_eq!(timers.len(), 1);
    assert_eq!(timers[0].computer_id.as_uuid(), Uuid::from_u128(101));

    for id in [bad_id, Uuid::from_u128(101)] {
        sqlx::query!("INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at) VALUES ($1, 'macrod_missing', $2)", id, now()).execute(&pool).await.unwrap();
    }
    repo.postpone_macrod_timers(host.id, due).await.unwrap();
    let corrupt_timer = sqlx::query_scalar!("SELECT fire_at FROM hosted_runtime_timer WHERE computer_id = $1 AND kind = 'macrod_missing'", bad_id).fetch_one(&pool).await.unwrap();
    assert_eq!(corrupt_timer, now());

    // Broken lifecycle JSON must still retain the guest's ownership identity.
    sqlx::query!(
        "UPDATE hosted_runtime SET state = '{}'::jsonb, name = 'Computer 102' WHERE id = $1",
        bad_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.instances_expected(host.id).await.unwrap().iter().any(
        |record| matches!(record, ComputerRecord::NeedsAttention { id, .. } if *id == corrupt)
    ));
    assert_eq!(repo.list_for_team(TEAM).await.unwrap().len(), 2);
}
