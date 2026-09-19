use tokio::time::{Duration, timeout};

use super::*;

#[tokio::test]
async fn send_is_recorded_and_succeeds_by_default() {
    let (transport, mut probe): (FakeTransport<String, String>, _) = FakeTransport::new();
    let (sender, _receiver) = transport.split();
    sender.send("system_event".to_owned()).await.unwrap();

    let message = timeout(Duration::from_secs(1), probe.next_send())
        .await
        .expect("send should be recorded promptly");
    assert_eq!(message, "system_event");
}

#[tokio::test]
async fn fail_next_send_fails_exactly_one_send() {
    let (transport, mut probe): (FakeTransport<String, String>, _) = FakeTransport::new();
    probe.fail_next_send("socket closed");
    let (sender, _receiver) = transport.split();

    assert!(sender.send("system_event".to_owned()).await.is_err());
    assert!(sender.send("system_event".to_owned()).await.is_ok());
}

#[tokio::test]
async fn fail_next_recv_fails_exactly_one_recv() {
    let (transport, mut probe): (FakeTransport<String, String>, _) = FakeTransport::new();
    probe.fail_next_recv("no such connection");
    probe.push_incoming("system_event".to_owned());
    let (_sender, mut receiver) = transport.split();

    assert!(receiver.recv().await.is_err());
    assert_eq!(
        receiver.recv().await.unwrap(),
        Some("system_event".to_owned())
    );
}

#[tokio::test]
async fn push_incoming_is_delivered_by_recv() {
    let (transport, mut probe): (FakeTransport<String, String>, _) = FakeTransport::new();

    probe.push_incoming("system_event".to_owned());
    let (_sender, mut receiver) = transport.split();

    let delivered = timeout(Duration::from_secs(1), receiver.recv())
        .await
        .expect("recv should return promptly")
        .expect("recv should not fail");
    assert_eq!(delivered, Some("system_event".to_owned()));
}
