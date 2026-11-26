use super::*;
use crate::domain::overcommit::{MemoryReport, Refusal, WakeAdmission};
use crate::domain::ports::OvercommitRepo;

/// 32 GiB host, memory admitted 1:1 with no reserve (four standard 8 GiB
/// computers), live limits at 70 / 80 / 90 %, a start adds 1 GiB, reports
/// stay fresh 30 s. No report yet.
async fn live_host(pool: &PgPool, repo: &PgComputerRepo) -> Host {
    let host = host(repo, "overcommit-test", 32, 0, 4).await;
    sqlx::query!(
        r#"
        UPDATE hosted_runtime_host
        SET cpu_allocation_percent = 400, ram_allocation_percent = 100, reserved_vcpus = 0,
            reserved_memory_gib = 0, memory_low_watermark_percent = 70,
            memory_high_watermark_percent = 80, memory_hard_ceiling_percent = 90,
            start_resident_memory_mib = 1024, minimum_idle_seconds = 900,
            memory_report_freshness_seconds = 30, resident_memory_mib = NULL,
            memory_reported_at = NULL
        WHERE id = $1
        "#,
        host.id.into_inner(),
    )
    .execute(pool)
    .await
    .unwrap();
    host
}

fn resident(gib: u64, at: DateTime<Utc>) -> MemoryReport {
    MemoryReport {
        resident_memory_mib: gib * 1024,
        reported_at: at,
    }
}

fn starts(computer: &Computer) -> bool {
    computer.state.phase == Phase::Provisioning { start: true }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_host_admits_nothing_without_a_fresh_memory_report(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;

    assert!(!starts(&bought(&repo, 1).await), "no report yet");
    repo.record_memory_report(host.id, resident(4, now() - Duration::seconds(31)))
        .await
        .unwrap();
    assert!(!starts(&bought(&repo, 2).await), "a stale report");
    repo.record_memory_report(host.id, resident(4, now() - Duration::seconds(5)))
        .await
        .unwrap();
    assert!(starts(&bought(&repo, 3).await));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_older_report_never_replaces_a_newer_one(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;
    let newer = resident(4, now());
    repo.record_memory_report(host.id, newer).await.unwrap();
    repo.record_memory_report(host.id, resident(1, now() - Duration::seconds(10)))
        .await
        .unwrap();
    assert_eq!(
        repo.host_overcommit(host.id).await.unwrap().unwrap().report,
        Some(newer)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_host_over_its_high_watermark_or_near_its_ceiling_refuses_starts(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;
    // 80% of 32 GiB is 25.6 GiB.
    repo.record_memory_report(host.id, resident(26, now()))
        .await
        .unwrap();
    assert!(!starts(&bought(&repo, 1).await));
    // Under the high watermark, the start would still fit under the ceiling (28.8 GiB).
    repo.record_memory_report(host.id, resident(25, now() + Duration::seconds(1)))
        .await
        .unwrap();
    let computer = bought(&repo, 2).await;
    assert!(starts(&computer));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn hibernated_computers_free_their_allocation_until_they_wake(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;
    repo.record_memory_report(host.id, resident(4, now()))
        .await
        .unwrap();
    // Four standard computers fill the host's 32 GiB of allocation.
    let awake: Vec<Computer> = futures::future::join_all((1..=4).map(|id| bought(&repo, id))).await;
    assert!(awake.iter().all(starts));
    assert!(!starts(&bought(&repo, 5).await));

    // Relief hibernates the first; a sixth fits now.
    repo.mark_hibernated(awake[0].id, now()).await.unwrap();
    let fifth = bought(&repo, 6).await;
    assert!(starts(&fifth));

    // The first may not wake while the host is full; its wake stays asked for.
    assert!(repo.request_wake(awake[0].id, now()).await.unwrap());
    assert_eq!(
        repo.admit_wake(awake[0].id, now()).await.unwrap(),
        WakeAdmission::Refused(Refusal::MemoryAllocation)
    );
    assert_eq!(
        repo.wakes_requested(host.id).await.unwrap(),
        vec![awake[0].id]
    );

    // Once the fifth is hibernated too, the first wakes and counts again.
    repo.mark_hibernated(fifth.id, now()).await.unwrap();
    assert_eq!(
        repo.admit_wake(awake[0].id, now()).await.unwrap(),
        WakeAdmission::Admitted
    );
    assert_eq!(repo.wakes_requested(host.id).await.unwrap(), vec![]);
    assert_eq!(
        repo.admit_wake(awake[0].id, now()).await.unwrap(),
        WakeAdmission::NotHibernated
    );
    assert_eq!(
        repo.admit_wake(fifth.id, now()).await.unwrap(),
        WakeAdmission::Refused(Refusal::MemoryAllocation)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_fleet_observation_is_the_truth_about_hibernation(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;
    repo.record_memory_report(host.id, resident(4, now()))
        .await
        .unwrap();
    let first = bought(&repo, 1).await.id;
    let second = bought(&repo, 2).await.id;

    repo.sync_hibernated(host.id, &[first, second], now())
        .await
        .unwrap();
    assert!(repo.request_wake(first, now()).await.unwrap());
    // Observed later: the first runs again (its team restarted it), the second sleeps.
    repo.sync_hibernated(host.id, &[second], now() + Duration::minutes(1))
        .await
        .unwrap();
    assert!(!repo.request_wake(first, now()).await.unwrap());
    assert_eq!(repo.wakes_requested(host.id).await.unwrap(), vec![]);
    let marked = sqlx::query_scalar!(
        "SELECT hibernated_at FROM hosted_runtime WHERE id = $1",
        second.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(marked, Some(now()), "an earlier mark is kept");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn powering_on_a_hibernated_computer_asks_for_its_wake(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;
    repo.record_memory_report(host.id, resident(4, now()))
        .await
        .unwrap();
    let computer = bought(&repo, 1).await.id;
    repo.apply(computer, Event::InstanceStarted, now())
        .await
        .unwrap();
    repo.apply(computer, Event::MacrodConnected, now())
        .await
        .unwrap();
    repo.mark_hibernated(computer, now()).await.unwrap();

    repo.apply(computer, Event::PowerOn, now() + Duration::seconds(1))
        .await
        .unwrap();
    assert_eq!(repo.wakes_requested(host.id).await.unwrap(), vec![computer]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_report_measured_before_a_start_keeps_counting_it(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = live_host(&pool, &repo).await;
    repo.record_memory_report(host.id, resident(4, now() - Duration::seconds(10)))
        .await
        .unwrap();
    assert!(starts(&bought(&repo, 1).await));
    let pending = || async {
        repo.host_overcommit(host.id)
            .await
            .unwrap()
            .unwrap()
            .pending_starts
    };
    assert_eq!(pending().await, 1);

    // Measured before the start, applied after it: the start stays pending.
    repo.record_memory_report(host.id, resident(4, now() - Duration::seconds(5)))
        .await
        .unwrap();
    assert_eq!(pending().await, 1);
    // Measured after it: the report counts it now.
    repo.record_memory_report(host.id, resident(5, now() + Duration::seconds(1)))
        .await
        .unwrap();
    assert_eq!(pending().await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_host_takes_the_measured_defaults_and_an_edited_row_keeps_its_settings(pool: PgPool) {
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let registration = || HostRegistration {
        name: crate::domain::models::HostName::try_new("microvm-1").unwrap(),
        vcpus: 32,
        memory_gb: 128,
    };
    // 6:1 vCPUs past 2 reserved: (32 - 2) * 6 / 4 = 45 units; 4:1 memory past
    // 16 GiB: (128 - 16) * 4 / 8 = 56. CPU is scarcer; two sold per awake.
    let first = repo.register_host(registration()).await.unwrap();
    assert_eq!(
        (first.awake_capacity_units, first.sold_capacity_units),
        (45, 90)
    );
    sqlx::query!(
        "UPDATE hosted_runtime_host SET ram_allocation_percent = 100, reserved_memory_gib = 0, oversell_factor = 3 WHERE id = $1",
        first.id.into_inner(),
    )
    .execute(&pool)
    .await
    .unwrap();

    // The next registration applies the edit and keeps it: 128 / 8 = 16 units.
    let again = repo.register_host(registration()).await.unwrap();

    assert_eq!(again.id, first.id);
    assert_eq!(
        (again.awake_capacity_units, again.sold_capacity_units),
        (16, 48)
    );
}
