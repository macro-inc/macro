use super::user_cleanup::action;
use super::*;
use tokio::sync::mpsc::Receiver;

const TEAM: Uuid = Uuid::from_u128(0x7EA3);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x7EA5);

fn purging_service(
    actions: Vec<ScheduledAction>,
) -> (TestService, Arc<FakeRepo>, Receiver<DispatchEvent>) {
    let repo = Arc::new(FakeRepo::default());
    *repo.actions.lock().unwrap() = actions;
    let (tx, rx) = tokio::sync::mpsc::channel(10);
    let service = TestService::new(
        Arc::clone(&repo),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    );
    (service, repo, rx)
}

#[tokio::test]
async fn purges_a_disabled_claimed_action_once_and_announces_its_delete() {
    let mut held = action(Owner::Team(TEAM), true);
    held.enabled = false;
    held.claimed = Some(Utc::now());
    let unrelated = action(Owner::Bot(bot_id::BotId::TEST_A), false);
    let (service, repo, mut rx) = purging_service(vec![held.clone(), unrelated.clone()]);
    let id = held.id.unwrap();

    for _ in 0..2 {
        let outcome = service
            .purge_owned_action(id, &Owner::Team(TEAM))
            .await
            .unwrap();
        assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    }

    let remaining: Vec<_> = repo.actions.lock().unwrap().iter().map(|a| a.id).collect();
    assert_eq!(remaining, [unrelated.id]);
    assert!(matches!(rx.try_recv().unwrap(), DispatchEvent::Delete(a) if a.id == held.id));
    assert!(rx.try_recv().is_err(), "the retry announces nothing");
}

#[tokio::test]
async fn leaves_an_action_another_owner_holds() {
    let held = action(Owner::Team(TEAM), false);
    let (service, repo, mut rx) = purging_service(vec![held.clone()]);

    for other in [
        Owner::Team(OTHER_TEAM),
        Owner::Bot(bot_id::BotId::TEST_A),
        Owner::User(user()),
    ] {
        let outcome = service
            .purge_owned_action(held.id.unwrap(), &other)
            .await
            .unwrap();
        assert_eq!(outcome, OwnedPurgeOutcome::OwnedElsewhere);
    }

    assert_eq!(repo.actions.lock().unwrap().len(), 1);
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn a_stopped_dispatcher_fails_the_purge_before_deleting_the_row() {
    let held = action(Owner::Team(TEAM), false);
    let (service, repo, rx) = purging_service(vec![held.clone()]);
    drop(rx);

    let purged = service
        .purge_owned_action(held.id.unwrap(), &Owner::Team(TEAM))
        .await;

    assert!(purged.is_err());
    assert_eq!(repo.actions.lock().unwrap().len(), 1);
}
