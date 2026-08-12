use super::*;

fn ping(channel_id: &str) -> RelayedWatchNotification {
    RelayedWatchNotification {
        state: "exists".to_owned(),
        channel_id: channel_id.to_owned(),
        resource_id: format!("res-{channel_id}"),
    }
}

#[tokio::test]
async fn publish_reaches_only_the_matching_token() {
    let registry = RelayRegistry::default();
    let mut alpha = registry.subscribe("token-alpha");
    let mut beta = registry.subscribe("token-beta");

    assert_eq!(registry.publish("token-alpha", ping("chan-1")), 1);
    assert_eq!(alpha.recv().await.unwrap(), ping("chan-1"));
    assert!(beta.try_recv().is_err());
}

#[tokio::test]
async fn publish_without_subscribers_is_dropped() {
    let registry = RelayRegistry::default();
    assert_eq!(registry.publish("stray-token", ping("chan-1")), 0);
}

#[tokio::test]
async fn disconnected_tokens_are_reclaimed_on_the_next_publish() {
    let registry = RelayRegistry::default();
    let receiver = registry.subscribe("token-alpha");
    drop(receiver);

    assert_eq!(registry.publish("token-alpha", ping("chan-1")), 0);
    assert!(
        registry.inner.lock().unwrap().is_empty(),
        "the dead entry is removed"
    );
}

#[tokio::test]
async fn every_subscriber_for_one_token_receives_the_delivery() {
    let registry = RelayRegistry::default();
    let mut first = registry.subscribe("token-alpha");
    let mut second = registry.subscribe("token-alpha");

    assert_eq!(registry.publish("token-alpha", ping("chan-1")), 2);
    assert_eq!(first.recv().await.unwrap(), ping("chan-1"));
    assert_eq!(second.recv().await.unwrap(), ping("chan-1"));
}
