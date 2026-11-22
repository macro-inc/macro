use super::*;
use futures::StreamExt as _;
use harness_id::HarnessId;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

fn start_runtime(listener: &TcpListener) -> Runtime {
    Runtime::start(
        &MacroApi {
            egress_url: None,
            teammate_network: None,
            api_url: format!("http://{}", listener.local_addr().unwrap()),
            storage_url: "http://unused".to_owned(),
            web_url: "http://unused".to_owned(),
        },
        &HarnessCredentials {
            harness_id: HarnessId::TEST_A,
            token: "mhns_test".to_owned(),
            pairing_id: None,
        },
        Harness {
            command: "cat".to_owned(),
            args: Vec::new(),
            env: Default::default(),
        },
        Path::new("/"),
        None,
        ActiveTurns::default(),
        None,
        crate::harness::Handoffs::channel().0,
        None,
        None,
    )
}

#[tokio::test]
#[expect(
    clippy::result_large_err,
    reason = "the handshake callback's error type is fixed by tungstenite's Callback trait"
)]
async fn retries_transient_failure_and_closed_connection_without_triggers() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let runtime = start_runtime(&listener);
    let (socket, _) = listener.accept().await.unwrap();
    let _ = tokio_tungstenite::accept_hdr_async(
        socket,
        |_: &tungstenite::handshake::server::Request, _| {
            Err(tungstenite::http::Response::builder()
                .status(429)
                .body(None)
                .unwrap())
        },
    )
    .await;

    let (socket, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
        .await
        .expect("retry startup without an agent trigger")
        .unwrap();
    let mut socket = accept_async(socket).await.unwrap();
    runtime.ensure_connected().await.unwrap();
    // Concurrent deliveries must share the existing connection.
    let (first, second) = tokio::join!(runtime.ensure_connected(), runtime.ensure_connected());
    first.unwrap();
    second.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );

    socket.close(None).await.unwrap();
    while socket.next().await.is_some() {}
    let (socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
        .await
        .expect("reconnect after the gateway closes while idle")
        .unwrap();
    let _socket = accept_async(socket).await.unwrap();
    runtime.ensure_connected().await.unwrap();
}

#[tokio::test]
#[expect(
    clippy::result_large_err,
    reason = "the handshake callback's error type is fixed by tungstenite's Callback trait"
)]
async fn refused_credentials_stop_reconnecting() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let runtime = start_runtime(&listener);
    let (socket, _) = listener.accept().await.unwrap();
    let _ = tokio_tungstenite::accept_hdr_async(
        socket,
        |_: &tungstenite::handshake::server::Request, _| {
            Err(tungstenite::http::Response::builder()
                .status(401)
                .body(None)
                .unwrap())
        },
    )
    .await;

    let error = tokio::time::timeout(Duration::from_secs(1), runtime.ensure_connected())
        .await
        .expect("permanent refusal should finish without waiting for a retry")
        .unwrap_err();
    assert!(matches!(error, tungstenite::Error::ConnectionClosed));
    assert!(runtime._task.is_finished());
}

#[tokio::test(start_paused = true)]
async fn dispatch_does_not_wait_forever_for_a_connection() {
    let (_sender, connected) = watch::channel(false);
    let runtime = Runtime {
        connected,
        agents_changed: Arc::default(),
        _task: AbortOnDropHandle::new(tokio::spawn(std::future::pending())),
    };
    let error = runtime.ensure_connected().await.unwrap_err();
    assert!(
        matches!(error, tungstenite::Error::Io(error) if error.kind() == std::io::ErrorKind::TimedOut)
    );
}

#[test]
fn retry_policy_distinguishes_temporary_refusals_from_invalid_credentials() {
    for (status, retry) in [
        (401, false),
        (403, false),
        (404, false),
        (408, true),
        (429, true),
        (503, true),
    ] {
        let error = tungstenite::Error::Http(Box::new(
            tungstenite::http::Response::builder()
                .status(status)
                .body(None)
                .unwrap(),
        ));
        assert_eq!(worth_redialing(&error), retry, "HTTP {status}");
        // Only a 401 is the credentials: the gateway's 403 is a claim's.
        assert_eq!(
            super::credentials_refused(&error),
            status == 401,
            "HTTP {status}"
        );
    }
    assert!(worth_redialing(&tungstenite::Error::ConnectionClosed));
    assert!(worth_redialing(&tungstenite::Error::Io(
        std::io::ErrorKind::ConnectionRefused.into(),
    )));
    for error in [
        tungstenite::error::UrlError::UnsupportedUrlScheme,
        tungstenite::error::UrlError::UnableToConnect("invalid credential header".to_owned()),
    ] {
        assert!(!worth_redialing(&tungstenite::Error::Url(error)));
    }
}

/// Whether `delay` is within a quarter of `expected`, the jitter bound.
fn near(delay: Duration, expected: Duration) -> bool {
    delay >= expected.mul_f64(0.75) && delay <= expected.mul_f64(1.25)
}

#[test]
fn a_healthy_connection_is_redialed_at_once_and_failures_back_off() {
    let mut backoff = reconnect_strategy();
    let ms = Duration::from_millis;
    let first = redial_delay(None, &mut backoff);
    assert!(near(first, ms(250)), "first redial after {first:?}");
    let second = redial_delay(None, &mut backoff);
    assert!(near(second, ms(500)), "second redial after {second:?}");
    // A connection that dropped quickly is still a failure.
    let third = redial_delay(Some(Duration::from_secs(1)), &mut backoff);
    assert!(near(third, ms(1_000)), "third redial after {third:?}");
    for _ in 0..10 {
        redial_delay(None, &mut backoff);
    }
    let capped = redial_delay(None, &mut backoff);
    assert!(
        near(capped, MAX_RECONNECT_DELAY),
        "capped redial after {capped:?}"
    );
    assert_eq!(
        redial_delay(Some(HEALTHY_CONNECTION), &mut backoff),
        Duration::ZERO
    );
    let after_reset = redial_delay(None, &mut backoff);
    assert!(
        near(after_reset, ms(250)),
        "redial after a healthy connection: {after_reset:?}"
    );
}

#[tokio::test]
async fn the_agent_starts_while_the_runtime_dials() {
    // Accepts the TCP connection but never answers the handshake, so the
    // dial is still pending when the agent reports in.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let directory = tempfile::tempdir().unwrap();
    let started = directory.path().join("started");
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&started)
            .status()
            .unwrap()
            .success()
    );
    let _runtime = Runtime::start(
        &MacroApi {
            egress_url: None,
            teammate_network: None,
            api_url: format!("http://{}", listener.local_addr().unwrap()),
            storage_url: "http://unused".to_owned(),
            web_url: "http://unused".to_owned(),
        },
        &HarnessCredentials {
            harness_id: HarnessId::TEST_A,
            token: "mhns_test".to_owned(),
            pairing_id: None,
        },
        Harness {
            command: "sh".to_owned(),
            args: vec![
                "-c".to_owned(),
                format!("echo up > {}; exec cat", started.display()),
            ],
            env: Default::default(),
        },
        Path::new("/"),
        None,
        ActiveTurns::default(),
        None,
        crate::harness::Handoffs::channel().0,
        None,
        None,
    );
    let read = tokio::task::spawn_blocking(move || std::fs::read_to_string(started));
    let line = tokio::time::timeout(Duration::from_secs(3), read)
        .await
        .expect("the agent starts before the runtime connects")
        .unwrap()
        .unwrap();
    assert_eq!(line, "up\n");
    let (_socket, _) = listener.accept().await.unwrap();
}
