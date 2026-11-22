use std::sync::atomic::{AtomicUsize, Ordering};

use uuid::Uuid;

use super::*;

const LAPTOP: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d01));
const DESKTOP: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d02));

#[tokio::test(start_paused = true)]
async fn a_press_during_a_recheck_joins_it() {
    let rechecks = HostRechecks::default();
    let sends = AtomicUsize::new(0);
    let entered = tokio::sync::Notify::new();
    let release = tokio::sync::Notify::new();
    let send = || async {
        sends.fetch_add(1, Ordering::SeqCst);
        entered.notify_one();
        release.notified().await;
    };

    let first = rechecks.ask(LAPTOP, send);
    let second = async {
        entered.notified().await;
        let joined = rechecks.ask(LAPTOP, send);
        release.notify_one();
        joined.await
    };
    let (first, second) = tokio::join!(first, second);

    assert!(first);
    assert!(!second, "joined the one in flight");
    assert_eq!(sends.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_machine_is_asked_at_most_once_every_ten_seconds() {
    let rechecks = HostRechecks::default();
    let sends = AtomicUsize::new(0);
    let send = || async {
        sends.fetch_add(1, Ordering::SeqCst);
    };

    assert!(rechecks.ask(LAPTOP, send).await);
    tokio::time::advance(RECHECK_INTERVAL - Duration::from_millis(1)).await;
    assert!(!rechecks.ask(LAPTOP, send).await);
    // Another machine has its own limit.
    assert!(rechecks.ask(DESKTOP, send).await);
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(rechecks.ask(LAPTOP, send).await);

    assert_eq!(sends.load(Ordering::SeqCst), 3);
}

#[tokio::test(start_paused = true)]
async fn a_press_whose_caller_gave_up_leaves_the_next_press_to_send() {
    let rechecks = HostRechecks::default();
    let sends = AtomicUsize::new(0);

    let abandoned = tokio::time::timeout(
        Duration::from_secs(1),
        rechecks.ask(LAPTOP, std::future::pending::<()>),
    )
    .await;
    assert!(abandoned.is_err());

    assert!(
        rechecks
            .ask(LAPTOP, || async {
                sends.fetch_add(1, Ordering::SeqCst);
            })
            .await
    );
    assert_eq!(sends.load(Ordering::SeqCst), 1);
}
