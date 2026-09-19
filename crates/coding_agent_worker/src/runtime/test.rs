use super::*;
use crate::config::HarnessScope;
use futures::StreamExt as _;
use harness_id::HarnessId;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

fn start_runtime(listener: &TcpListener) -> Runtime {
    Runtime::start(
        &MacroApi {
            api_url: format!("http://{}", listener.local_addr().unwrap()),
            storage_url: "http://unused".to_owned(),
            web_url: "http://unused".to_owned(),
        },
        &HarnessCredentials {
            harness_id: HarnessId::TEST_A,
            token: "mhns_test".to_owned(),
            scope: HarnessScope::User,
        },
        Harness {
            command: "cat".to_owned(),
            args: Vec::new(),
        },
        Path::new("/"),
    )
}

#[tokio::test]
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
