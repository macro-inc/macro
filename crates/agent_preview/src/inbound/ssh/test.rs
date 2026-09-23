use super::*;
use crate::{outbound::ssh_tunnel::SshTunnel, testing::*};
use axum::{
    Router,
    extract::ws::{Message, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use entity_access::domain::models::AccessLevel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn stock_openssh_forwards_http_and_websockets_and_stop_closes_them() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = upstream.local_addr().unwrap().port();
    let upstream_task = tokio::spawn(async move {
        axum::serve(
            upstream,
            Router::new()
                .route("/", get(|| async { "live preview" }))
                .route(
                    "/socket",
                    get(|ws: WebSocketUpgrade| async {
                        ws.on_upgrade(|mut socket| async move {
                            while let Some(Ok(message)) = socket.recv().await {
                                if let Message::Text(text) = message
                                    && socket.send(Message::Text(text)).await.is_err()
                                {
                                    break;
                                }
                            }
                        })
                        .into_response()
                    }),
                ),
        )
        .await
        .unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ssh_port = listener.local_addr().unwrap().port();
    let (service, _, key) = fixture(ssh_port);
    let shutdown = CancellationToken::new();
    let server = tokio::spawn(serve(
        listener,
        key,
        service.clone(),
        Arc::new(|h| Arc::new(SshTunnel::new(h))),
        shutdown.clone(),
    ));
    // Exercise the real stateless MCP transport and execute its exact returned script.
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let mcp = crate::inbound::toolset::router(service.clone(), vec!["localhost".into()]);
    let call = || {
        axum::http::Request::builder().method("POST").uri("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .body(axum::body::Body::from(serde_json::json!({"jsonrpc":"2.0", "id":1, "method":"tools/call", "params":{"name":"SharePreview", "arguments":{"port":port}}}).to_string())).unwrap()
    };
    let denied = mcp.clone().oneshot(call()).await.unwrap();
    let denied: serde_json::Value =
        serde_json::from_slice(&denied.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(denied.get("error").is_some());
    let mut request = call();
    request
        .headers_mut()
        .insert("authorization", "Bearer session-secret".parse().unwrap());
    let result = mcp.oneshot(request).await.unwrap();
    assert_eq!(result.status(), axum::http::StatusCode::OK);
    let result: serde_json::Value =
        serde_json::from_slice(&result.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(result.get("error").is_none());
    let output: serde_json::Value =
        serde_json::from_str(result["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let preview_id = output["preview"]["id"].as_str().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("connect.sh");
    std::fs::write(&script, output["script"].as_str().unwrap()).unwrap();
    let status = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new("sh")
            .arg(&script)
            .kill_on_drop(true)
            .status(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(status.success(), "generated script failed");
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let preview = service.get(receipt(AccessLevel::View)).unwrap().unwrap();
            if preview.status == PreviewStatus::Ready {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    let ticket = service.launch(receipt(AccessLevel::View)).unwrap();
    let cookie = service.redeem(preview_id, &ticket.ticket).await.unwrap();
    let lease = service.viewer(preview_id, &cookie, true).await.unwrap();
    let mut stream = lease.tunnel().unwrap().open().await.unwrap();
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert!(String::from_utf8(bytes).unwrap().contains("live preview"));
    // Traverse the public HTTP proxy and its real 101 upgrade over the SSH channel.
    let public = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let public_addr = public.local_addr().unwrap();
    let gateway = tokio::spawn(
        axum::serve(public, super::super::http::router(service.clone())).into_future(),
    );
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let host = format!("{}.preview.test", preview_id);
    let mut request = format!("ws://{host}/socket?token=app-owned")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", format!("https://{host}").parse().unwrap());
    request.headers_mut().insert(
        "cookie",
        format!("__Host-macro-preview={cookie}").parse().unwrap(),
    );
    let connection = tokio::net::TcpStream::connect(public_addr).await.unwrap();
    let (mut ws, _) = tokio_tungstenite::client_async(request, connection)
        .await
        .unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        "hmr-update".into(),
    ))
    .await
    .unwrap();
    assert_eq!(
        ws.next().await.unwrap().unwrap().into_text().unwrap(),
        "hmr-update"
    );
    service.stop(receipt(AccessLevel::Edit)).await.unwrap();
    assert!(lease.cancel.is_cancelled());
    assert!(
        tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .is_ok()
    );
    shutdown.cancel();
    server.await.unwrap().unwrap();
    gateway.abort();
    upstream_task.abort();
}

/// The gateway must never be usable as anything but a reverse tunnel for its own
/// previews. Shell/exec and `direct-tcpip` are refused only because `Connection`
/// leaves those handlers unimplemented and russh drops the reply handle, which
/// fails closed — a library default, not an explicit deny, so assert it here:
/// were it ever to flip, this service would become an open TCP relay running
/// inside the services network.
#[tokio::test]
async fn gateway_refuses_outbound_relay_and_shell() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ssh_port = listener.local_addr().unwrap().port();
    let (service, _, key) = fixture(ssh_port);
    let shutdown = CancellationToken::new();
    let server = tokio::spawn(serve(
        listener,
        key.clone(),
        service.clone(),
        Arc::new(|h| Arc::new(SshTunnel::new(h))),
        shutdown.clone(),
    ));
    let share = service
        .share(crate::testing::identity(), 3000)
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let known = dir.path().join("known_hosts");
    std::fs::write(
        &known,
        format!(
            "[localhost]:{ssh_port} {}\n",
            crate::inbound::ssh::public_key(&key).unwrap()
        ),
    )
    .unwrap();
    let base = |token: &str| {
        let mut c = tokio::process::Command::new("ssh");
        c.args([
            "-F",
            "/dev/null",
            "-o",
            "BatchMode=yes",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
        ])
        .arg("-o")
        .arg(format!("UserKnownHostsFile={}", known.display()))
        .args(["-p", &ssh_port.to_string(), "-l", token, "localhost"]);
        c.kill_on_drop(true);
        c
    };

    // 1. A session channel (shell/exec) must be refused.
    let exec = tokio::time::timeout(
        Duration::from_secs(20),
        base(&share.token).arg("echo pwned").output(),
    )
    .await
    .unwrap()
    .unwrap();
    println!(
        "exec status={:?}\n  stderr: {}",
        exec.status.code(),
        String::from_utf8_lossy(&exec.stderr).trim()
    );
    assert!(
        !exec.status.success(),
        "the gateway granted a session channel"
    );
    assert!(!String::from_utf8_lossy(&exec.stdout).contains("pwned"));

    // 2. direct-tcpip: an outbound relay to a third party must be refused.
    //    The token is single-use, and a second share for the same owner would hit
    //    the creation rate limit, so charge it to another account.
    let other = crate::domain::AgentIdentity {
        session: "00000000-0000-0000-0000-000000000002".into(),
        owner: "macro|other@example.com".into(),
    };
    let share2 = service.share(other, 3000).await.unwrap();
    let relay = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let relay_port = relay.local_addr().unwrap().port();
    let hit = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let hit2 = hit.clone();
    tokio::spawn(async move {
        if relay.accept().await.is_ok() {
            hit2.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    });
    let local = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_port = local.local_addr().unwrap().port();
    drop(local);
    let mut forward = base(&share2.token)
        .args([
            "-N",
            "-L",
            &format!("127.0.0.1:{local_port}:127.0.0.1:{relay_port}"),
        ])
        .spawn()
        .unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    // Drive traffic through the forward: ssh only opens the direct-tcpip
    // channel when something actually connects to the listening side.
    let probe = tokio::net::TcpStream::connect(("127.0.0.1", local_port)).await;
    println!("local forward accepted a client: {}", probe.is_ok());
    if let Ok(mut probe) = probe {
        use tokio::io::AsyncWriteExt;
        let _ = probe.write_all(b"GET / HTTP/1.0\r\n\r\n").await;
        let mut sink = Vec::new();
        let _ = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::io::AsyncReadExt::read_to_end(&mut probe, &mut sink),
        )
        .await;
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    let _ = forward.kill().await;
    assert!(
        !hit.load(std::sync::atomic::Ordering::SeqCst),
        "the gateway opened an outbound TCP connection on a client's behalf"
    );
    println!("direct-tcpip relay: refused");

    shutdown.cancel();
    let _ = server.await;
}
