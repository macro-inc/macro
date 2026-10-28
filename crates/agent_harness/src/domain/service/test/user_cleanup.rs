use super::*;
use model_owner::Owner;

#[tokio::test]
async fn delete_user_sessions_cleans_live_and_inactive_sessions_only_for_the_owner() {
    let (service, repo, containers, _, _) = harness();
    let live = AgentSessionId::new();
    live_sandboxed_coder_session(&service, &containers, live).await;
    // More than one cleanup batch, including disconnected sessions.
    let mut owned = vec![live];
    for _ in 0..101 {
        owned.push(
            disconnected_session_owned_by(&repo, &containers, Owner::User(staff_sender())).await,
        );
    }
    let other = disconnected_session_owned_by(&repo, &containers, Owner::User(sender())).await;
    let bot_owned =
        disconnected_session_owned_by(&repo, &containers, Owner::Bot(BotId::TEST_A)).await;

    service.delete_user_sessions(staff_sender()).await.unwrap();
    assert_eq!(containers.torn_down(), owned.len());
    for id in owned {
        assert!(repo.get(id).await.is_err());
    }
    assert!(repo.get(other).await.is_ok());
    assert!(repo.get(bot_owned).await.is_ok());
    assert!(containers.container(other).is_some());
    service.delete_user_sessions(staff_sender()).await.unwrap();
    assert_eq!(containers.torn_down(), 102, "retry is a no-op");
}

#[tokio::test]
async fn delete_user_sessions_preserves_the_row_on_teardown_failure_and_can_retry() {
    let (service, repo, containers, _, _) = harness();
    let id = disconnected_session_owned_by(&repo, &containers, Owner::User(sender())).await;
    containers.fail_next_teardown();
    assert!(service.delete_user_sessions(sender()).await.is_err());
    assert!(repo.get(id).await.is_ok());
    assert!(containers.container(id).is_some());

    service.delete_user_sessions(sender()).await.unwrap();
    assert!(repo.get(id).await.is_err());
    assert_eq!(containers.torn_down(), 1);
}
