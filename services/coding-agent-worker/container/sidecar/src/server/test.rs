use std::net::SocketAddr;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite;

use super::*;

static UNIQUE: AtomicUsize = AtomicUsize::new(0);

/// Write an executable shell script that stands in for the ACP harness. The
/// sidecar invokes it as `<script> acp --cwd <workspace>`; the bodies ignore
/// those args.
fn fake_harness(body: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "acp-sidecar-test-{}-{}",
        std::process::id(),
        UNIQUE.fetch_add(1, Ordering::Relaxed),
    ));
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write fake harness");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .expect("chmod fake harness");
    path
}

/// Serve the sidecar app on an ephemeral port with the given harness.
async fn serve(harness: &Path) -> SocketAddr {
    serve_with_token(harness, None).await
}

async fn serve_with_token(harness: &Path, token: Option<&str>) -> SocketAddr {
    let config = Config::new(
        harness.to_str().expect("utf-8 path").to_owned(),
        std::env::temp_dir()
            .to_str()
            .expect("utf-8 path")
            .to_owned(),
        token.map(str::to_owned),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(axum::serve(listener, app(config)).into_future());
    addr
}

async fn connect(
    addr: SocketAddr,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tungstenite::Error,
> {
    tokio_tungstenite::connect_async(format!("ws://{addr}/"))
        .await
        .map(|(ws, _)| ws)
}

#[tokio::test]
async fn ping_answers_ok() {
    let harness = fake_harness("exec cat");
    let addr = serve(&harness).await;

    let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
    stream
        .write_all(
            format!("GET /ping HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await
        .expect("send request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .await
        .expect("read response");
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.ends_with("ok"), "{response}");
}

#[tokio::test]
async fn round_trips_one_message_per_frame() {
    let harness = fake_harness("exec cat");
    let addr = serve(&harness).await;
    let mut ws = connect(addr).await.expect("ws connect");

    // One frame in = one NDJSON line on stdin; `cat` echoes the line back,
    // which must come out as one text frame without the newline.
    ws.send(tungstenite::Message::Text("{\"id\":1}".into()))
        .await
        .expect("send text");
    let echoed = ws.next().await.expect("stream open").expect("read frame");
    assert_eq!(echoed, tungstenite::Message::Text("{\"id\":1}".into()));

    // Binary frames carry the same contract.
    ws.send(tungstenite::Message::Binary(b"{\"id\":2}".to_vec().into()))
        .await
        .expect("send binary");
    let echoed = ws.next().await.expect("stream open").expect("read frame");
    assert_eq!(echoed, tungstenite::Message::Text("{\"id\":2}".into()));
}

#[tokio::test]
async fn token_gates_the_bridge_but_not_ping() {
    let harness = fake_harness("exec cat");
    let addr = serve_with_token(&harness, Some("s3cret")).await;

    // /ping stays open: it's the readiness probe and carries no secrets.
    let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
    stream
        .write_all(
            format!("GET /ping HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await
        .expect("send request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .await
        .expect("read response");
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");

    match connect(addr).await {
        Err(tungstenite::Error::Http(response)) => {
            assert_eq!(response.status(), 401, "{response:?}");
        }
        other => panic!("expected HTTP 401 rejection, got {other:?}"),
    }
    match tokio_tungstenite::connect_async(format!("ws://{addr}/?token=wrong")).await {
        Err(tungstenite::Error::Http(response)) => {
            assert_eq!(response.status(), 401, "{response:?}");
        }
        other => panic!("expected HTTP 401 rejection, got {other:?}"),
    }

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/?token=s3cret"))
        .await
        .expect("token-bearing connect");
    ws.send(tungstenite::Message::Text("hi".into()))
        .await
        .expect("send");
    let echoed = ws.next().await.expect("stream open").expect("read frame");
    assert_eq!(echoed, tungstenite::Message::Text("hi".into()));
}

#[tokio::test]
async fn second_connection_gets_503() {
    let harness = fake_harness("exec cat");
    let addr = serve(&harness).await;
    let _first = connect(addr).await.expect("first ws connect");

    match connect(addr).await {
        Err(tungstenite::Error::Http(response)) => {
            assert_eq!(response.status(), 503, "{response:?}");
        }
        other => panic!("expected HTTP 503 rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn slot_frees_after_disconnect() {
    let harness = fake_harness("exec cat");
    let addr = serve(&harness).await;

    let mut first = connect(addr).await.expect("first ws connect");
    first.close(None).await.expect("close first");

    // The permit is released once the server notices the disconnect; retry
    // until the slot frees.
    for _ in 0..100 {
        if connect(addr).await.is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("connection slot never freed after disconnect");
}

#[tokio::test]
async fn harness_exit_closes_socket() {
    let harness = fake_harness("printf bye");
    let addr = serve(&harness).await;
    let mut ws = connect(addr).await.expect("ws connect");

    let bye = ws.next().await.expect("stream open").expect("read frame");
    assert_eq!(bye.into_data().as_ref(), b"bye");

    match ws.next().await {
        Some(Ok(tungstenite::Message::Close(_))) | None => {}
        Some(Ok(other)) => panic!("expected close, got {other:?}"),
        Some(Err(_)) => {} // server closed the connection
    }
}

#[tokio::test]
async fn disconnect_kills_harness() {
    let pidfile = std::env::temp_dir().join(format!(
        "acp-sidecar-test-pid-{}-{}",
        std::process::id(),
        UNIQUE.fetch_add(1, Ordering::Relaxed),
    ));
    let harness = fake_harness(&format!("echo $$ > {} && exec cat", pidfile.display()));
    let addr = serve(&harness).await;
    let mut ws = connect(addr).await.expect("ws connect");

    let pid = loop {
        if let Ok(contents) = std::fs::read_to_string(&pidfile)
            && !contents.trim().is_empty()
        {
            break contents.trim().to_owned();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert!(alive(&pid), "harness should be running while connected");

    ws.close(None).await.expect("close ws");
    for _ in 0..100 {
        if !alive(&pid) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("harness still alive after disconnect");
}

/// `kill -0`: true while the process exists.
fn alive(pid: &str) -> bool {
    std::process::Command::new("kill")
        .args(["-0", pid])
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
