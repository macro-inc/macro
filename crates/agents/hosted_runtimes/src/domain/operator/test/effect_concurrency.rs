use std::sync::Arc;

use super::*;

/// The operator with two computers on the home host, each with a pending
/// start held at the fleet's gate.
async fn two_starts(
    max_concurrent_starts: Option<u32>,
) -> (
    Arc<ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>>,
    Arc<redeploy::FleetGate>,
) {
    let gate = Arc::new(redeploy::FleetGate::default());
    let operator = ComputerOperator::start(
        FakeRepo {
            sold_units: 9,
            home_max_concurrent_starts: max_concurrent_starts,
            ..FakeRepo::default()
        },
        FakeFleet {
            start_gate: Some(Arc::clone(&gate)),
            ..Default::default()
        },
        FakeHarnesses::default(),
        FakeSetupNotices::default(),
        FixedClock,
        Arc::new(crate::domain::fakes::FixedDeployment),
    )
    .await
    .unwrap();
    let first = paid_computer(&operator).await;
    let second = ComputerId::new_from_uuid(Uuid::from_u128(2));
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let mut copy = computers.get(&first).unwrap().clone();
        copy.id = second;
        computers.insert(second, copy);
    }
    let mut effects = operator.repo.effects.lock().unwrap();
    effects.clear();
    for (id, computer) in [(40, first), (41, second)] {
        effects.push(PendingEffect {
            id,
            computer_id: computer,
            effect: Effect::Start { host: HOST },
            attempts: 0,
            queued_at: chrono::DateTime::UNIX_EPOCH,
        });
    }
    drop(effects);
    (Arc::new(operator), gate)
}

#[tokio::test]
async fn a_host_runs_up_to_its_max_concurrent_starts_at_once() {
    let (operator, gate) = two_starts(Some(2)).await;
    let pass = tokio::spawn({
        let operator = Arc::clone(&operator);
        async move { operator.run_fleet_effects().await }
    });

    // Both may enter before this waits, and Notify keeps only one permit.
    while gate.active.load(Ordering::SeqCst) < 2 {
        gate.entered.notified().await;
    }
    gate.release.notify_one();
    gate.release.notify_one();

    assert_eq!(pass.await.unwrap().unwrap(), 2);
}

#[tokio::test]
async fn without_a_limit_a_hosts_effects_run_one_at_a_time() {
    let (operator, gate) = two_starts(None).await;
    let pass = tokio::spawn({
        let operator = Arc::clone(&operator);
        async move { operator.run_fleet_effects().await }
    });

    for _ in 0..2 {
        gate.entered.notified().await;
        assert_eq!(gate.active.load(Ordering::SeqCst), 1);
        gate.release.notify_one();
    }

    assert_eq!(pass.await.unwrap().unwrap(), 2);
}
