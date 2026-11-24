use std::time::Duration;

use super::*;

const RUN: &str = "0199a000-0000-7000-8000-0000000000aa";

#[tokio::test]
async fn stopping_a_running_routine_sends_a_stop_for_its_run() {
    let svc = service(true);
    let action = svc
        .create_action(&user_principal(), configuration(false))
        .await
        .unwrap();
    let run: Uuid = RUN.parse().unwrap();
    svc.repo.running.lock().unwrap().push(RunningRun {
        routine_id: action.id.unwrap(),
        parent_id: None,
        owner: action.owner.clone(),
        run_id: run,
    });
    let watch = svc.stops.watch();

    svc.stop_run(owner_receipt(action.id.unwrap()))
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), watch.stopped(run))
        .await
        .expect("the run's stop is heard");
}

#[tokio::test]
async fn stopping_a_routine_that_is_not_running_does_nothing() {
    let svc = service(true);
    let action = svc
        .create_action(&user_principal(), configuration(false))
        .await
        .unwrap();
    let watch = svc.stops.watch();

    svc.stop_run(owner_receipt(action.id.unwrap()))
        .await
        .unwrap();

    let heard = tokio::time::timeout(Duration::ZERO, watch.stopped(RUN.parse().unwrap())).await;
    assert!(heard.is_err(), "no stop is sent");
}
