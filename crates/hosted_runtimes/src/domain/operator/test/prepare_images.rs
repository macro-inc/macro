use super::*;

#[tokio::test]
async fn every_reconcile_prepares_the_images_new_computers_are_created_from() {
    let operator = operator(FakeFleet::default()).await;

    operator.reconcile().await.unwrap();
    operator.reconcile().await.unwrap();

    assert_eq!(operator.fleet.prepares.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn an_image_that_cannot_be_prepared_still_lets_reconcile_handle_drift() {
    let operator = operator(FakeFleet {
        prepare_fails: true,
        ..FakeFleet::default()
    })
    .await;
    let id = paid_computer(&operator).await;
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.state = ComputerState {
            phase: Phase::Running,
            macrod_connected: true,
            macrod_misses: 0,
            ..computer.state.clone()
        };
    }

    operator.reconcile().await.unwrap();

    let crashed = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert!(matches!(crashed.state.phase, Phase::Crashed { .. }));
    assert_eq!(operator.fleet.prepares.load(Ordering::SeqCst), 1);
}
