use super::*;
use crate::domain::lifecycle::MACROD_GRACE;
use crate::domain::ports::InstanceStatus;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn boot_timeout_uses_durable_timer_and_refreshes_grace_after_downtime(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = repo
        .register_host(HostRegistration {
            name: "boot-test-host".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
            image: crate::domain::image::GuestImage::try_new("macro-box/test").unwrap(),
        })
        .await
        .unwrap();
    let id = bought(&repo, 1).await.id;
    repo.apply(id, Event::InstanceStarted, now()).await.unwrap();
    let overdue = repo
        .due_timers(now() + Duration::hours(1), 10)
        .await
        .unwrap();
    assert_eq!(overdue.len(), 1);
    assert_eq!(overdue[0].fire_at, now() + MACROD_GRACE);
    drop(repo);

    let restarted = PgComputerRepo::new(pool, policy());
    let startup = now() + Duration::hours(1);
    restarted
        .postpone_macrod_timers(host.id, startup + MACROD_GRACE)
        .await
        .unwrap();
    assert!(restarted.due_timers(startup, 10).await.unwrap().is_empty());
    // A timer already read by an overlapping replica cannot consume the refreshed row.
    assert!(
        restarted
            .fire_timer(overdue[0].clone(), None, startup)
            .await
            .unwrap()
            .is_none()
    );
    let due = restarted
        .due_timers(startup + MACROD_GRACE, 10)
        .await
        .unwrap();
    assert_eq!(due.len(), 1);
    let computer = restarted
        .fire_timer(
            due[0].clone(),
            Some(InstanceStatus::Running),
            startup + MACROD_GRACE,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(computer.state.phase, Phase::Booting);
    assert!(computer.state.recent_crashes.is_empty());
    let next = restarted
        .due_timers(startup + MACROD_GRACE * 2, 10)
        .await
        .unwrap();
    assert_eq!(next[0].fire_at, startup + MACROD_GRACE * 2);
    restarted
        .apply(id, Event::MacrodConnected, startup + MACROD_GRACE)
        .await
        .unwrap();
    assert_eq!(
        restarted
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .phase,
        Phase::Running
    );
}
