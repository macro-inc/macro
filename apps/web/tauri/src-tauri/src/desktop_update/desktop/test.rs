use super::download::{COMPLETE, PARTIAL, RECORD};
use super::*;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ARTIFACT: &str = include_str!("test/fixtures/update.txt");

/// What the fixture server answers for the artifact.
#[derive(Clone, Copy)]
enum Serve {
    /// The signed artifact, honoring `Range` requests.
    Signed,
    /// The signed artifact, always whole, as a server without range support.
    SignedWhole,
    /// Bytes that don't match the signature.
    Tampered,
}

struct Run {
    result: Result<bool, CheckError>,
    status: Status,
    outcomes: Vec<Outcome>,
    /// The first byte each artifact request asked for.
    artifact_requests: Vec<u64>,
    store: Store,
    signature: String,
}

/// Exercises the actual pinned updater's HTTP and version handling, and the
/// store's download, resume and signature check, against a local server.
async fn check_fixture(directory: &Path, version: &str, serve: Serve) -> Run {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let signature = include_str!("test/fixtures/update.txt.sig")
        .trim()
        .to_string();
    let manifest = serde_json::json!({
        "version": version,
        "url": format!("http://{address}/artifact"),
        "signature": signature,
    })
    .to_string();
    let artifact_requests = Arc::new(Mutex::new(Vec::new()));
    let requests = artifact_requests.clone();
    let server = tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let size = stream.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
            let response = if request.starts_with("get /artifact ") {
                let start = request
                    .lines()
                    .find_map(|line| line.strip_prefix("range: bytes="))
                    .and_then(|range| range.trim_end().trim_end_matches('-').parse::<usize>().ok())
                    .unwrap_or(0);
                requests.lock().unwrap().push(start as u64);
                match serve {
                    Serve::Signed if start >= ARTIFACT.len() => format!(
                        "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        ARTIFACT.len()
                    ),
                    Serve::Signed if start > 0 => format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n{}",
                        ARTIFACT.len() - start,
                        ARTIFACT.len() - 1,
                        ARTIFACT.len(),
                        &ARTIFACT[start..]
                    ),
                    Serve::Signed | Serve::SignedWhole => format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{ARTIFACT}",
                        ARTIFACT.len()
                    ),
                    Serve::Tampered => "HTTP/1.1 200 OK\r\nContent-Length: 17\r\nConnection: close\r\n\r\ntampered artifact".to_string(),
                }
            } else {
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{manifest}",
                    manifest.len()
                )
            };
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let pubkey = include_str!("test/fixtures/updater.pub").trim();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": pubkey,
            "endpoints": [format!("http://{address}/latest.json")],
            "dangerousInsecureTransportProtocol": true,
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let coordinator = Coordinator::new(true, "1.0.0".into());
    let store = Store::new(directory.to_path_buf(), pubkey.into());
    let result = check(app.handle(), &coordinator, &store, &Timing::start()).await;
    let status = coordinator.state.lock().unwrap().status.clone();
    let reports = coordinator.reports.lock().unwrap().take();
    assert!(
        reports
            .iter()
            .all(|report| report.current_version == "1.0.0")
    );
    server.abort();
    let artifact_requests = artifact_requests.lock().unwrap().clone();
    Run {
        result,
        status,
        outcomes: reports.into_iter().map(|report| report.outcome).collect(),
        artifact_requests,
        store,
        signature,
    }
}

/// The download report a ready run ends with.
fn downloaded(run: &Run) -> (u64, u64) {
    let [
        found,
        Outcome::Downloaded {
            target_version,
            download_bytes,
            resumed_bytes,
            ..
        },
    ] = run.outcomes.as_slice()
    else {
        panic!("unexpected outcomes {:?}", run.outcomes);
    };
    assert_eq!(
        found,
        &Outcome::UpdateFound {
            target_version: "99.0.0".into()
        }
    );
    assert_eq!(target_version, "99.0.0");
    assert_eq!(
        run.status,
        Status::Ready {
            version: "99.0.0".into()
        }
    );
    (*download_bytes, *resumed_bytes)
}

/// Leaves the first `kept` bytes of a finished download as a partial one, as
/// if the app quit mid-download.
fn interrupt(directory: &Path, kept: u64) {
    std::fs::rename(directory.join(COMPLETE), directory.join(PARTIAL)).unwrap();
    std::fs::File::options()
        .write(true)
        .open(directory.join(PARTIAL))
        .unwrap()
        .set_len(kept)
        .unwrap();
}

#[tokio::test]
async fn a_verified_download_becomes_ready_and_is_saved() {
    let directory = tempfile::tempdir().unwrap();
    let run = check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert_eq!(downloaded(&run), (ARTIFACT.len() as u64, 0));
    assert_eq!(run.artifact_requests, [0]);
    assert_eq!(
        std::fs::read_to_string(directory.path().join(COMPLETE)).unwrap(),
        ARTIFACT
    );
}

#[tokio::test]
async fn an_interrupted_download_resumes_where_it_stopped() {
    let directory = tempfile::tempdir().unwrap();
    check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    interrupt(directory.path(), 10);

    let run = check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert_eq!(run.artifact_requests, [10]);
    assert_eq!(downloaded(&run), (ARTIFACT.len() as u64, 10));
}

#[tokio::test]
async fn a_download_stopped_before_it_was_marked_complete_becomes_ready() {
    let directory = tempfile::tempdir().unwrap();
    check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    interrupt(directory.path(), ARTIFACT.len() as u64);

    let run = check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert_eq!(run.artifact_requests, [ARTIFACT.len() as u64]);
    assert_eq!(
        downloaded(&run),
        (ARTIFACT.len() as u64, ARTIFACT.len() as u64)
    );
}

#[tokio::test]
async fn a_server_ignoring_the_range_replaces_the_saved_bytes() {
    let directory = tempfile::tempdir().unwrap();
    check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    interrupt(directory.path(), 10);
    // Saved bytes that a whole response must not be appended to.
    std::fs::write(directory.path().join(PARTIAL), "0123456789").unwrap();

    let run = check_fixture(directory.path(), "99.0.0", Serve::SignedWhole).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert_eq!(run.artifact_requests, [10]);
    assert_eq!(downloaded(&run), (ARTIFACT.len() as u64, 0));
}

#[tokio::test]
async fn a_saved_download_is_reused_without_downloading() {
    let directory = tempfile::tempdir().unwrap();
    check_fixture(directory.path(), "99.0.0", Serve::Signed).await;

    let run = check_fixture(directory.path(), "99.0.0", Serve::Tampered).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert!(run.artifact_requests.is_empty());
    assert_eq!(
        downloaded(&run),
        (ARTIFACT.len() as u64, ARTIFACT.len() as u64)
    );
}

#[tokio::test]
async fn a_newer_update_replaces_the_saved_download() {
    let directory = tempfile::tempdir().unwrap();
    check_fixture(directory.path(), "98.0.0", Serve::Signed).await;
    interrupt(directory.path(), 10);

    let run = check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert_eq!(run.artifact_requests, [0]);
    assert_eq!(downloaded(&run), (ARTIFACT.len() as u64, 0));
    assert!(
        std::fs::read_to_string(directory.path().join(RECORD))
            .unwrap()
            .contains("99.0.0")
    );
}

#[tokio::test]
async fn tampered_download_never_becomes_ready_or_stays_saved() {
    let directory = tempfile::tempdir().unwrap();
    let run = check_fixture(directory.path(), "99.0.0", Serve::Tampered).await;
    assert!(!matches!(run.status, Status::Ready { .. }));
    assert_eq!(
        run.outcomes,
        [Outcome::UpdateFound {
            target_version: "99.0.0".into()
        }]
    );
    let Outcome::DownloadFailed {
        target_version,
        failure,
        consecutive_failures,
        ..
    } = run.result.unwrap_err().outcome(3)
    else {
        panic!("expected a download failure");
    };
    assert_eq!(target_version, "99.0.0");
    assert_eq!(failure, Failure::new(FailureKind::Signature));
    assert_eq!(consecutive_failures, 3);
    for name in [COMPLETE, PARTIAL, RECORD] {
        assert!(!directory.path().join(name).exists(), "{name} kept");
    }
}

#[tokio::test]
async fn a_saved_download_changed_after_it_was_ready_does_not_install() {
    let directory = tempfile::tempdir().unwrap();
    let run = check_fixture(directory.path(), "99.0.0", Serve::Signed).await;
    assert!(run.store.read_verified(&run.signature).is_ok());

    std::fs::write(directory.path().join(COMPLETE), "tampered artifact").unwrap();
    let error = run.store.read_verified(&run.signature).unwrap_err();
    assert_eq!(Failure::from(&error), Failure::new(FailureKind::Signature));
    assert!(!directory.path().join(COMPLETE).exists());
}

#[tokio::test]
async fn older_releases_are_not_downloaded_and_clear_saved_downloads() {
    let directory = tempfile::tempdir().unwrap();
    check_fixture(directory.path(), "99.0.0", Serve::Signed).await;

    let run = check_fixture(directory.path(), "0.0.0", Serve::Signed).await;
    assert!(matches!(run.result, Ok(true)), "{:?}", run.result);
    assert_eq!(run.status, Status::Idle);
    assert_eq!(run.outcomes, [Outcome::UpToDate]);
    assert!(run.artifact_requests.is_empty());
    for name in [COMPLETE, PARTIAL, RECORD] {
        assert!(!directory.path().join(name).exists(), "{name} kept");
    }
}
