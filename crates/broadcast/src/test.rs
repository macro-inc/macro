use std::{num::NonZeroUsize, time::Duration};

use tokio::time::timeout;
use tokio_util::task::TaskTracker;

use super::*;

fn capacity(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).expect("test capacities are non-zero")
}

async fn wait_until(mut predicate: impl FnMut() -> bool) {
    timeout(Duration::from_secs(1), async {
        while !predicate() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("condition should become true before timeout");
}

#[tokio::test]
async fn publishes_only_to_the_requested_key() {
    let manager = BroadcastManager::new(TaskTracker::new(), capacity(8));
    let mut first = manager.subscribe("first", capacity(2));
    let mut second = manager.subscribe("second", capacity(2));

    assert_eq!(manager.publish(&"first", 42).unwrap(), 1);
    assert_eq!(first.recv().await, Some(42));
    assert_eq!(
        second.try_recv(),
        Err(tokio::sync::mpsc::error::TryRecvError::Empty)
    );

    drop(first);
    drop(second);
    manager.shutdown().await;
}

#[tokio::test]
async fn publishes_to_every_subscriber_for_a_key() {
    let manager = BroadcastManager::new(TaskTracker::new(), capacity(8));
    let mut first = manager.subscribe("user", capacity(2));
    let mut second = manager.subscribe("user", capacity(2));

    assert_eq!(manager.publish(&"user", 42).unwrap(), 2);
    assert_eq!(first.recv().await, Some(42));
    assert_eq!(second.recv().await, Some(42));

    drop(first);
    drop(second);
    manager.shutdown().await;
}

#[tokio::test]
async fn returns_the_unpublished_value_when_there_are_no_subscribers() {
    let manager = BroadcastManager::new(TaskTracker::new(), capacity(8));

    assert_eq!(
        manager
            .publish(&"missing", String::from("message"))
            .unwrap_err()
            .0,
        String::from("message")
    );

    manager.shutdown().await;
}

#[tokio::test]
async fn removes_a_key_after_its_last_receiver_closes() {
    let manager = BroadcastManager::<_, &str, usize>::new(TaskTracker::new(), capacity(8));
    let receiver = manager.subscribe("user", capacity(2));

    assert!(manager.subscriber_count(&"user") > 0);
    assert_eq!(manager.subscriber_count(&"user"), 1);

    drop(receiver);
    wait_until(|| manager.subscriber_count(&"user") == 0).await;
    wait_until(|| manager.channels.is_empty()).await;

    assert_eq!(manager.publish(&"user", 42).unwrap_err().0, 42);

    manager.shutdown().await;
}

#[tokio::test]
async fn disconnects_a_subscriber_when_its_buffer_is_full() {
    let manager = BroadcastManager::new(TaskTracker::new(), capacity(8));
    let mut receiver = manager.subscribe("user", capacity(1));

    assert_eq!(manager.publish(&"user", 1).unwrap(), 1);
    wait_until(|| receiver.len() == 1).await;

    assert_eq!(manager.publish(&"user", 2).unwrap(), 1);
    wait_until(|| manager.subscriber_count(&"user") == 0).await;

    assert_eq!(receiver.recv().await, Some(1));
    assert_eq!(receiver.recv().await, None);

    manager.shutdown().await;
}

#[tokio::test]
async fn shutdown_closes_active_subscriptions_without_waiting_for_receivers() {
    let manager = BroadcastManager::<_, &str, usize>::new(TaskTracker::new(), capacity(8));
    let mut receiver = manager.subscribe("user", capacity(1));

    timeout(Duration::from_secs(1), manager.shutdown())
        .await
        .expect("shutdown should not wait for the subscriber receiver");

    assert_eq!(receiver.recv().await, None);
}
