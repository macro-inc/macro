use super::*;
use tokio::sync::oneshot;

#[tokio::test]
async fn sends_past_the_cap_are_dropped_until_one_finishes() {
    let sender = BackgroundSender::new(AnalyticsClient::noop(), 1);
    let (release, released) = oneshot::channel::<()>();

    let first = sender
        .spawn(|_| async move {
            let _ = released.await;
        })
        .unwrap();
    assert!(sender.spawn(|_| async {}).is_none());

    release.send(()).unwrap();
    first.await.unwrap();

    assert!(sender.spawn(|_| async {}).is_some());
}
