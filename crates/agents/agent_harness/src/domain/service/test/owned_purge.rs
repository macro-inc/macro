use super::*;
use model_owner::Owner;
use shared_entity_registry::OwnedPurgeOutcome;

const TEAM: Uuid = Uuid::from_u128(0x7EA3);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x7EA4);

#[tokio::test]
async fn purge_owned_session_releases_and_deletes_sessions_their_owner_still_holds() {
    let (service, repo, containers, _, _) = harness();
    for owner in [Owner::Team(TEAM), Owner::Bot(BotId::TEST_A)] {
        let id = disconnected_session_owned_by(&repo, &containers, owner.clone()).await;

        let outcome = service.purge_owned_session(id, &owner).await.unwrap();

        assert_eq!(outcome, OwnedPurgeOutcome::Purged);
        assert!(repo.get(id).await.is_err(), "the row is gone");
        assert!(containers.container(id).is_none(), "the sandbox is gone");
    }
    assert_eq!(containers.torn_down(), 2);
}

#[tokio::test]
async fn purge_owned_session_leaves_a_session_another_owner_holds() {
    let (service, repo, containers, _, _) = harness();
    let id = disconnected_session_owned_by(&repo, &containers, Owner::Team(TEAM)).await;

    for other in [
        Owner::Team(OTHER_TEAM),
        Owner::Bot(BotId::TEST_A),
        Owner::User(sender()),
    ] {
        let outcome = service.purge_owned_session(id, &other).await.unwrap();
        assert_eq!(outcome, OwnedPurgeOutcome::OwnedElsewhere);
    }

    assert!(repo.get(id).await.is_ok());
    assert!(containers.container(id).is_some());
    assert_eq!(containers.torn_down(), 0);
}

#[tokio::test]
async fn purge_owned_session_of_a_missing_session_is_purged_and_releases_nothing_more() {
    let (service, repo, containers, _, _) = harness();
    let id = disconnected_session_owned_by(&repo, &containers, Owner::Team(TEAM)).await;
    let owner = Owner::Team(TEAM);
    service.purge_owned_session(id, &owner).await.unwrap();

    for missing in [id, AgentSessionId::new()] {
        let outcome = service.purge_owned_session(missing, &owner).await.unwrap();
        assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    }

    assert_eq!(containers.torn_down(), 1, "a retry is a no-op");
}

#[tokio::test]
async fn purge_owned_session_keeps_the_row_on_teardown_failure_and_a_retry_finishes() {
    let (service, repo, containers, _, _) = harness();
    let owner = Owner::Team(TEAM);
    let id = disconnected_session_owned_by(&repo, &containers, owner.clone()).await;
    containers.fail_next_teardown();

    assert!(service.purge_owned_session(id, &owner).await.is_err());
    assert!(repo.get(id).await.is_ok());
    assert!(containers.container(id).is_some());

    let outcome = service.purge_owned_session(id, &owner).await.unwrap();
    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert!(repo.get(id).await.is_err());
    assert_eq!(containers.torn_down(), 1);
}
