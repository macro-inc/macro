use super::*;

fn computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
    id: ComputerId,
) -> Computer {
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get(&id)
        .unwrap()
        .clone()
}

async fn run_effects(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
) {
    while operator.run_fleet_effects().await.unwrap() > 0 {}
}

#[tokio::test]
async fn a_lost_guest_is_recreated_on_its_data_disk_with_a_new_enrollment() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    run_effects(&operator).await;
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    // The instance disappears; its data disk stays on the host.
    operator.fleet.created.lock().unwrap().remove(&id);

    operator
        .repo
        .apply(id, Event::InstanceLost, now())
        .await
        .unwrap();
    run_effects(&operator).await;

    assert_eq!(
        operator.fleet.volumes.lock().unwrap().get(&id),
        Some(&"data-1".to_owned())
    );
    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(
        enrollments
            .iter()
            .map(|(enrollment, _)| enrollment.generation)
            .collect::<Vec<_>>(),
        [EnrollmentGeneration::new(1), EnrollmentGeneration::new(2)]
    );
    assert_ne!(enrollments[0].0.pairing_id, enrollments[1].0.pairing_id);
    assert_eq!(computer(&operator, id).state.phase, Phase::Booting);
}
