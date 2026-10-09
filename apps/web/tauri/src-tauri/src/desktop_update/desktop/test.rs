use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Exercises the actual pinned updater's HTTP, version and signature handling.
async fn check_fixture(version: &str, corrupt: bool) -> (tauri_plugin_updater::Result<()>, Status) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let manifest = serde_json::json!({
        "version": version,
        "url": format!("http://{address}/artifact"),
        "signature": include_str!("test/fixtures/update.txt.sig").trim(),
    })
    .to_string();
    let server = tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let size = stream.read(&mut request).await.unwrap();
            let body = if request[..size].starts_with(b"GET /artifact ") {
                if corrupt {
                    "tampered artifact".to_string()
                } else {
                    include_str!("test/fixtures/update.txt").to_string()
                }
            } else {
                manifest.clone()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": include_str!("test/fixtures/updater.pub").trim(),
            "endpoints": [format!("http://{address}/latest.json")],
            "dangerousInsecureTransportProtocol": true,
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let coordinator = Coordinator {
        state: Mutex::new(State::new(true)),
        check: Notify::new(),
        restart: Mutex::new(false),
    };
    let result = check(app.handle(), &coordinator).await;
    let status = coordinator.state.lock().unwrap().status.clone();
    server.abort();
    (result, status)
}

#[tokio::test]
async fn a_verified_download_becomes_ready() {
    let (result, status) = check_fixture("99.0.0", false).await;
    result.unwrap();
    assert_eq!(
        status,
        Status::Ready {
            version: "99.0.0".into()
        }
    );
}

#[tokio::test]
async fn tampered_download_never_becomes_ready() {
    let (result, status) = check_fixture("99.0.0", true).await;
    assert!(result.is_err());
    assert!(!matches!(status, Status::Ready { .. }));
}

#[tokio::test]
async fn older_releases_are_not_downloaded() {
    let (result, status) = check_fixture("0.0.0", false).await;
    result.unwrap();
    assert_eq!(status, Status::Idle);
}
