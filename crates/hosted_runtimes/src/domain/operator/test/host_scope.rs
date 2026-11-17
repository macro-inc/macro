use super::*;
use crate::domain::ports::DueTimer;

#[tokio::test]
async fn the_operator_leaves_another_hosts_effects_and_timers_alone() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    // Another control plane's host holds the computer.
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .host = HostId::new(Uuid::from_u128(0xdead));
    operator.repo.timers.lock().unwrap().push(DueTimer {
        computer_id: id,
        kind: TimerKind::RetentionExpired,
        fire_at: now(),
    });

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
    assert_eq!(operator.fire_timers().await.unwrap(), 0);

    assert!(operator.fleet.enrollments.lock().unwrap().is_empty());
    assert!(operator.fleet.calls.lock().unwrap().is_empty());
}
