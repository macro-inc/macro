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
