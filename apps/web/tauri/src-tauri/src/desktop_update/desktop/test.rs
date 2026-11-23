use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Exercises the actual pinned updater's HTTP, version and signature handling.
async fn check_fixture(
    version: &str,
    corrupt: bool,
) -> (Result<bool, CheckError>, Status, Vec<Outcome>) {
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
    let coordinator = Coordinator::new(true, "1.0.0".into());
    let result = check(app.handle(), &coordinator, &Timing::start()).await;
    let status = coordinator.state.lock().unwrap().status.clone();
    let reports = coordinator.reports.lock().unwrap().take();
    assert!(
        reports
            .iter()
            .all(|report| report.current_version == "1.0.0")
    );
    server.abort();
    (
        result,
        status,
        reports.into_iter().map(|report| report.outcome).collect(),
    )
}

#[tokio::test]
async fn a_verified_download_becomes_ready() {
    let (result, status, outcomes) = check_fixture("99.0.0", false).await;
    assert!(result.unwrap());
    assert_eq!(
        status,
        Status::Ready {
            version: "99.0.0".into()
        }
    );
    let [
        found,
        Outcome::Downloaded {
            target_version,
            download_bytes,
            ..
        },
    ] = outcomes.as_slice()
    else {
        panic!("unexpected outcomes {outcomes:?}");
    };
    assert_eq!(
        found,
        &Outcome::UpdateFound {
            target_version: "99.0.0".into()
        }
    );
    assert_eq!(target_version, "99.0.0");
    assert_eq!(
        *download_bytes,
        include_str!("test/fixtures/update.txt").len() as u64
    );
}

#[tokio::test]
async fn tampered_download_never_becomes_ready() {
    let (result, status, outcomes) = check_fixture("99.0.0", true).await;
    assert!(!matches!(status, Status::Ready { .. }));
    assert_eq!(
        outcomes,
        [Outcome::UpdateFound {
            target_version: "99.0.0".into()
        }]
    );
    let Outcome::DownloadFailed {
        target_version,
        failure,
        consecutive_failures,
        ..
    } = result.unwrap_err().outcome(3)
    else {
        panic!("expected a download failure");
    };
    assert_eq!(target_version, "99.0.0");
    assert_eq!(failure, Failure::new(FailureKind::Signature));
    assert_eq!(consecutive_failures, 3);
}

#[tokio::test]
async fn older_releases_are_not_downloaded() {
    let (result, status, outcomes) = check_fixture("0.0.0", false).await;
    assert!(result.unwrap());
    assert_eq!(status, Status::Idle);
    assert_eq!(outcomes, [Outcome::UpToDate]);
}

#[test]
fn releases_for_a_newer_os_are_unsupported() {
    let target = tauri_plugin_updater::target().unwrap();
    let feed = |entry: serde_json::Value| serde_json::json!({ "platforms": { target.clone(): entry, "other-arch": {} } });
    let minimum = feed(serde_json::json!({ "minimumSystemVersion": "13.0" }));
    assert_eq!(
        unsupported_minimum(&minimum, Some([12, 7, 6])),
        Some("13.0".into())
    );
    assert_eq!(unsupported_minimum(&minimum, Some([13, 0, 0])), None);
    assert_eq!(unsupported_minimum(&minimum, Some([26, 1, 0])), None);
    assert_eq!(unsupported_minimum(&minimum, None), None);
    assert_eq!(
        unsupported_minimum(&feed(serde_json::json!({})), Some([6, 12, 0])),
        None
    );

    for minimum in ["13.x", "13.0.0.1", ""] {
        let feed = feed(serde_json::json!({ "minimumSystemVersion": minimum }));
        assert_eq!(
            unsupported_minimum(&feed, Some([26, 1, 0])),
            Some(minimum.into())
        );
    }
}
