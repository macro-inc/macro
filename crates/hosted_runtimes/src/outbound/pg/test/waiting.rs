use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn releasing_awake_units_notifies_waiters_in_the_same_transaction(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "capacity-test".to_owned(),
        memory_gb: 8,
        reserve_gb: 0,
        oversell_factor: 9,
    })
    .await
    .unwrap();
    for (first, waiting, prepare, release) in [
        (1, 2, Event::PowerOff, Event::InstanceStopped),
        (5, 6, Event::MacrodConnected, Event::ReleaseNow),
    ] {
        let first = repo.reserve(standard(first), now()).await.unwrap().id;
        repo.apply(first, Event::PaymentConfirmed, now())
            .await
            .unwrap();
        repo.apply(first, Event::InstanceStarted, now())
            .await
            .unwrap();
        repo.apply(first, Event::MacrodConnected, now())
            .await
            .unwrap();
        repo.apply(first, prepare, now()).await.unwrap();
        let waiting = repo.reserve(standard(waiting), now()).await.unwrap().id;
        repo.apply(waiting, Event::PaymentConfirmed, now())
            .await
            .unwrap();
        repo.apply(waiting, Event::InstanceStopped, now())
            .await
            .unwrap();
        let blocked = repo
            .apply(waiting, Event::WakeRetry, now() + Duration::seconds(20))
            .await
            .unwrap()
            .unwrap();
        assert!(blocked.state.waiting_for_capacity());
        repo.apply(first, release, now() + Duration::seconds(21))
            .await
            .unwrap();
        let timers = repo
            .due_timers(now() + Duration::seconds(21), 100)
            .await
            .unwrap();
        let timer = timers
            .into_iter()
            .find(|timer| timer.computer_id == waiting && timer.kind.as_ref() == "capacity_changed")
            .expect("awake release must notify the waiting computer immediately");
        let awake = repo
            .fire_timer(timer, None, now() + Duration::seconds(21))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            awake.state.phase,
            Phase::Booting {
                host: awake.state.host().unwrap()
            }
        );
        assert!(!awake.state.wake_requested);
        repo.apply(waiting, Event::ReleaseNow, now() + Duration::seconds(22))
            .await
            .unwrap();
        repo.apply(first, Event::ReleaseNow, now() + Duration::seconds(22))
            .await
            .unwrap();
    }
}
