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
fn a_launch_after_a_failed_install_offers_to_try_again() {
    let path = std::env::temp_dir()
        .join(format!("macro-native-update-{}", uuid::Uuid::new_v4()))
        .join("pending-install.json");
    PendingInstall {
        from_version: "2026.1106.1".into(),
        target_version: "2026.1119.1".into(),
        trigger: Trigger::Restart,
        started_at_ms: 1_700_000_000_000,
        failure: Some(Failure::new(FailureKind::Authentication)),
    }
    .write(&path)
    .unwrap();
    let coordinator = Coordinator::new(true, "2026.1106.1".into());
    let report = coordinator.take_pending_install(&path).unwrap();
    assert!(matches!(report.outcome, Outcome::InstallFailed { .. }));

    // The failure outlasts the check that downloads the update again.
    let mut state = coordinator.state.lock().unwrap();
    assert!(state.begin_check());
    assert_eq!(
        state.snapshot().failed_install_version.as_deref(),
        Some("2026.1119.1")
    );
}

#[test]
fn a_launch_on_the_installed_update_offers_nothing_to_retry() {
    let path = std::env::temp_dir()
        .join(format!("macro-native-update-{}", uuid::Uuid::new_v4()))
        .join("pending-install.json");
    PendingInstall {
        from_version: "2026.1106.1".into(),
        target_version: "2026.1119.1".into(),
        trigger: Trigger::Quit,
        started_at_ms: 1_700_000_000_000,
        failure: None,
    }
    .write(&path)
    .unwrap();
    let coordinator = Coordinator::new(true, "2026.1119.1".into());
    let report = coordinator.take_pending_install(&path).unwrap();
    assert!(matches!(report.outcome, Outcome::Installed { .. }));
    assert_eq!(
        coordinator
            .state
            .lock()
            .unwrap()
            .snapshot()
            .failed_install_version,
        None
    );
}
