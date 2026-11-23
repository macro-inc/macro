//! Exercise the real transport deadline through an authenticated bounded stream.
use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::instrument::WithSubscriber;

async fn connection() -> (ProtocolTransport, Credentials, tokio::io::DuplexStream) {
    let (transport, credentials, peer, listener) = super::reuse_test::pooled_connection().await;
    drop((peer, listener));
    let (client, server) = tokio::io::duplex(1024);
    let key = ProtocolTransport::smtp_key(&credentials).unwrap();
    // Same Stream metering and submission code as a pooled TCP connection;
    // bounded IO makes backpressure independent of the host TCP buffer size.
    transport
        .smtp_pool
        .lock()
        .await
        .get_mut(&key)
        .unwrap()
        .stream = Stream::test_duplex(client);
    (transport, credentials, server)
}

#[tokio::test(start_paused = true)]
async fn a_peer_that_stops_reading_data_cannot_hold_submission_forever() {
    let telemetry = super::telemetry_test::FieldWrites::default();
    let _capture = telemetry.install();
    let (transport, credentials, server) = connection().await;
    let (data_started, started) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(server);
        for expected in [
            "RSET\r\n",
            "MAIL FROM:<owner@example.net>\r\n",
            "RCPT TO:<recipient@example.net>\r\n",
            "DATA\r\n",
        ] {
            let mut line = String::new();
            peer.read_line(&mut line).await.unwrap();
            assert_eq!(line, expected);
            peer.get_mut()
                .write_all(if expected == "DATA\r\n" {
                    b"354 continue\r\n"
                } else {
                    b"250 ready\r\n"
                })
                .await
                .unwrap();
        }
        data_started.send(()).unwrap();
        // Keep the socket open without reading the DATA body.
        let _ = released.await;
    });
    let submission = tokio::spawn(
        async move {
            let wire = format!("From: owner@example.net\r\n\r\n{}\r\n", "x".repeat(16_384));
            transport
                .submit(
                    &credentials,
                    "owner@example.net",
                    &["recipient@example.net".into()],
                    wire.as_bytes(),
                    tokio::time::Instant::now() + Duration::from_secs(60),
                )
                .await
        }
        .with_current_subscriber(),
    );
    started.await.unwrap();
    tokio::time::advance(Duration::from_secs(360)).await;
    // The extra second is a failure watchdog, not the production deadline.
    let outcome = tokio::time::timeout(Duration::from_secs(1), submission).await;
    release.send(()).unwrap();
    peer.await.unwrap();
    let result = outcome.unwrap().unwrap().unwrap();
    assert_eq!(result.outcome, SubmissionOutcome::Unknown);
    assert!(result.deadline_exceeded);
    assert!(telemetry.deadlines().iter().any(|fields| {
        fields
            .get("smtp.deadline_exceeded")
            .is_some_and(|values| values == &["true"])
    }));
}

#[tokio::test(start_paused = true)]
async fn a_slow_data_write_and_missing_final_reply_share_one_total_deadline() {
    let telemetry = super::telemetry_test::FieldWrites::default();
    let _capture = telemetry.install();
    let (transport, credentials, server) = connection().await;
    let (data_started, started) = tokio::sync::oneshot::channel();
    let (read_body, body_allowed) = tokio::sync::oneshot::channel::<()>();
    let (body_read, read) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(server);
        for expected in [
            "RSET\r\n",
            "MAIL FROM:<owner@example.net>\r\n",
            "RCPT TO:<recipient@example.net>\r\n",
            "DATA\r\n",
        ] {
            let mut line = String::new();
            peer.read_line(&mut line).await.unwrap();
            assert_eq!(line, expected);
            peer.get_mut()
                .write_all(if expected == "DATA\r\n" {
                    b"354 continue\r\n"
                } else {
                    b"250 ready\r\n"
                })
                .await
                .unwrap();
        }
        data_started.send(()).unwrap();
        body_allowed.await.unwrap();
        loop {
            let mut line = String::new();
            assert!(peer.read_line(&mut line).await.unwrap() > 0);
            if line == ".\r\n" {
                break;
            }
        }
        body_read.send(()).unwrap();
        // The peer accepted DATA bytes, but never sends the final reply.
        let _ = released.await;
    });
    let submission = tokio::spawn(
        async move {
            let wire = format!("From: owner@example.net\r\n\r\n{}\r\n", "x".repeat(16_384));
            transport
                .submit(
                    &credentials,
                    "owner@example.net",
                    &["recipient@example.net".into()],
                    wire.as_bytes(),
                    tokio::time::Instant::now() + Duration::from_secs(60),
                )
                .await
        }
        .with_current_subscriber(),
    );
    started.await.unwrap();
    tokio::time::advance(Duration::from_secs(340)).await;
    read_body.send(()).unwrap();
    read.await.unwrap();
    tokio::time::advance(Duration::from_secs(20)).await;
    let outcome = tokio::time::timeout(Duration::from_secs(1), submission).await;
    release.send(()).unwrap();
    peer.await.unwrap();
    let result = outcome.unwrap().unwrap().unwrap();
    assert_eq!(result.outcome, SubmissionOutcome::Unknown);
    assert!(result.deadline_exceeded);
    assert!(telemetry.deadlines().iter().any(|fields| {
        fields
            .get("smtp.deadline_exceeded")
            .is_some_and(|values| values == &["true"])
    }));
}
