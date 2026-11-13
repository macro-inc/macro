use super::*;
use crate::domain::lifecycle::SetupOutcome;
use crate::domain::ports::SetupNotice;

fn buyer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
}

#[tokio::test]
async fn the_first_connection_tells_the_buyer_once() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();

    operator.macrod_connected(HARNESS).await.unwrap();
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    operator.macrod_disconnected(HARNESS).await.unwrap();
    operator.macrod_connected(HARNESS).await.unwrap();
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);

    assert_eq!(
        *operator.notices.sent.lock().unwrap(),
        vec![SetupNotice {
            computer_id: id,
            team_id: TEAM,
            harness_id: Some(HARNESS),
            computer_name: "Ada".to_owned(),
            buyer: buyer(),
            outcome: SetupOutcome::Ready,
        }]
    );
}

#[tokio::test]
async fn a_failed_setup_tells_the_buyer_why() {
    let operator = operator(FakeFleet {
        rejects: true,
        ..FakeFleet::default()
    })
    .await;
    let id = paid_computer(&operator).await;

    operator.run_fleet_effects().await.unwrap(); // The rejected create.
    operator.run_fleet_effects().await.unwrap(); // The page.
    operator.run_fleet_effects().await.unwrap(); // The notice.

    assert_eq!(
        *operator.notices.sent.lock().unwrap(),
        vec![SetupNotice {
            computer_id: id,
            team_id: TEAM,
            harness_id: None,
            computer_name: "Ada".to_owned(),
            buyer: buyer(),
            outcome: SetupOutcome::Failed {
                failure: Failure::Create,
                failed_at: now(),
            },
        }]
    );
}

#[tokio::test]
async fn a_notice_that_cannot_be_sent_is_retried_and_never_fails_the_computer() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    operator.macrod_connected(HARNESS).await.unwrap();
    operator.notices.fail.store(true, Ordering::SeqCst);

    for _ in 0..MAX_EFFECT_ATTEMPTS {
        operator.repo.effect_run_after.lock().unwrap().clear();
        assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    }

    // Every attempt carries the same notice, so the adapter derives one id.
    let sent = operator.notices.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), MAX_EFFECT_ATTEMPTS as usize);
    assert!(sent.iter().all(|notice| *notice == sent[0]));
    let computer = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(computer.state.phase, Phase::Running);
    assert_eq!(computer.state.failure, None);
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
}
