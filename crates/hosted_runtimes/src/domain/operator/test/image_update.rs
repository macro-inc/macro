use super::*;

fn computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock>,
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

async fn run_effects(operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock>) {
    while operator.run_fleet_effects().await.unwrap() > 0 {}
}

#[tokio::test]
async fn an_image_update_and_its_rollback_keep_the_data_disk_and_pairing() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    run_effects(&operator).await;
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    let base = GuestImage::try_new(BASE_IMAGE).unwrap();
    let next = GuestImage::try_new("macro-box/2026-11-10").unwrap();
    assert_eq!(computer(&operator, id).image, Some(base.clone()));
    assert_eq!(
        operator.fleet.volumes.lock().unwrap().get(&id),
        Some(&"data-1".to_owned())
    );

    operator
        .repo
        .apply(
            id,
            Event::UpdateImage {
                image: next.clone(),
            },
            now(),
        )
        .await
        .unwrap();
    run_effects(&operator).await;

    let updated = computer(&operator, id);
    assert_eq!(updated.image, Some(next.clone()));
    assert_eq!(updated.previous_image, Some(base.clone()));
    assert_eq!(updated.state.phase, Phase::Booting { host: HOST });
    // The same data disk, and no new pairing: macrod reconnects as before.
    assert_eq!(
        operator.fleet.volumes.lock().unwrap().get(&id),
        Some(&"data-1".to_owned())
    );
    assert_eq!(operator.fleet.enrollments.lock().unwrap().len(), 1);
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    assert_eq!(
        computer(&operator, id).state.phase,
        Phase::Running { host: HOST }
    );

    // Rollback is an update to the previous image.
    operator
        .repo
        .apply(
            id,
            Event::UpdateImage {
                image: base.clone(),
            },
            now(),
        )
        .await
        .unwrap();
    run_effects(&operator).await;
    let rolled_back = computer(&operator, id);
    assert_eq!(rolled_back.image, Some(base.clone()));
    assert_eq!(rolled_back.previous_image, Some(next.clone()));
    assert_eq!(
        operator.fleet.volumes.lock().unwrap().get(&id),
        Some(&"data-1".to_owned())
    );
    assert_eq!(
        operator
            .fleet
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call.starts_with("rebuild"))
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            format!("rebuild {id} {next} start=true"),
            format!("rebuild {id} {base} start=true"),
        ]
    );

    // Release deletes the data disk with the guest.
    operator
        .repo
        .apply(id, Event::ReleaseNow, now())
        .await
        .unwrap();
    run_effects(&operator).await;
    assert_eq!(operator.fleet.volumes.lock().unwrap().get(&id), None);
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
    assert_eq!(
        computer(&operator, id).state.phase,
        Phase::Booting { host: HOST }
    );
}
