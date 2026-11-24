use super::*;
use tauri_plugin_updater::Error;

fn record_path() -> std::path::PathBuf {
    std::env::temp_dir()
        .join(format!("macro-native-update-{}", uuid::Uuid::new_v4()))
        .join("pending-install.json")
}

fn pending(failure: Option<Failure>) -> PendingInstall {
    PendingInstall {
        from_version: "2026.1106.1".into(),
        target_version: "2026.1119.1".into(),
        trigger: Trigger::Quit,
        started_at_ms: 1_700_000_000_000,
        failure,
    }
}

#[test]
fn updater_errors_become_closed_failure_kinds() {
    let denied = Error::Io(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "/Users/someone/Applications/Macro.app",
    ));
    assert_eq!(
        Failure::from(&denied),
        Failure {
            kind: FailureKind::Io,
            io_kind: Some("PermissionDenied".into()),
            http_status: None,
        }
    );
    assert_eq!(
        Failure::from(&Error::Network(
            "Download request failed with status: 404 Not Found".into()
        )),
        Failure {
            kind: FailureKind::Request,
            io_kind: None,
            http_status: Some(404),
        }
    );
    assert_eq!(
        Failure::from(&Error::Network("connection reset".into())).http_status,
        None
    );
    assert_eq!(
        Failure::from(&Error::ReleaseNotFound).kind,
        FailureKind::FeedUnavailable
    );
    assert_eq!(
        Failure::from(&Error::TargetNotFound("darwin-aarch64".into())).kind,
        FailureKind::PlatformMissing
    );
    assert_eq!(
        Failure::from(&Error::AuthenticationFailed).kind,
        FailureKind::Authentication
    );
}

#[test]
fn failures_never_carry_error_text() {
    let error = Error::Io(std::io::Error::other("/Users/someone/secret"));
    let json = serde_json::to_string(&Failure::from(&error)).unwrap();
    assert!(!json.contains("someone"), "{json}");
}

#[test]
fn bundle_locations_name_where_the_app_runs() {
    let location = |path: &str| BundleLocation::of_executable(Path::new(path));
    assert_eq!(
        location("/Applications/Macro.app/Contents/MacOS/Macro"),
        Some(BundleLocation::Applications)
    );
    assert_eq!(
        location(
            "/private/var/folders/xy/T/AppTranslocation/0A1B/d/Macro.app/Contents/MacOS/Macro"
        ),
        Some(BundleLocation::Translocated)
    );
    assert_eq!(
        location("/Volumes/Macro/Macro.app/Contents/MacOS/Macro"),
        Some(BundleLocation::MountedVolume)
    );
    assert_eq!(
        location("/Users/someone/Applications/Macro.app/Contents/MacOS/Macro"),
        Some(BundleLocation::Elsewhere)
    );
    assert_eq!(location("/usr/bin/macro"), None);
}

#[test]
fn reports_keep_the_newest_and_drain_once() {
    let mut reports = Reports::default();
    for started_at_ms in 0..(CAPACITY as u64 + 2) {
        reports.push(Report {
            started_at_ms,
            duration_ms: 0,
            current_version: "1.0.0".into(),
            bundle_location: None,
            outcome: Outcome::UpToDate,
        });
    }
    let taken = reports.take();
    assert_eq!(taken.len(), CAPACITY);
    assert_eq!(taken[0].started_at_ms, 2);
    assert!(reports.take().is_empty());
}

#[test]
fn a_launch_on_the_target_version_reports_the_install() {
    let path = record_path();
    pending(None).write(&path).unwrap();
    let report = PendingInstall::take(&path, "2026.1119.1", Some(BundleLocation::Applications));
    assert_eq!(
        report,
        Some(Report {
            started_at_ms: 1_700_000_000_000,
            duration_ms: 0,
            current_version: "2026.1119.1".into(),
            bundle_location: Some(BundleLocation::Applications),
            outcome: Outcome::Installed {
                from_version: "2026.1106.1".into(),
                target_version: "2026.1119.1".into(),
                trigger: Trigger::Quit,
            },
        })
    );
    assert!(!path.exists());
    assert_eq!(PendingInstall::take(&path, "2026.1119.1", None), None);
}

#[test]
fn a_launch_on_any_newer_version_counts_as_installed() {
    let path = record_path();
    pending(None).write(&path).unwrap();
    let report = PendingInstall::take(&path, "2026.1120.1", None).unwrap();
    assert_eq!(report.current_version, "2026.1120.1");
    assert!(matches!(report.outcome, Outcome::Installed { .. }));
}

#[test]
fn a_launch_on_an_older_copy_keeps_the_recorded_failure() {
    let path = record_path();
    let failure = Failure::new(FailureKind::Install);
    pending(Some(failure.clone())).write(&path).unwrap();
    let report = PendingInstall::take(&path, "2026.1105.1", None).unwrap();
    assert!(matches!(
        report.outcome,
        Outcome::InstallFailed { failure: recorded, .. } if recorded == failure
    ));
}

#[test]
fn rewriting_the_record_leaves_no_partial_file() {
    let path = record_path();
    pending(None).write(&path).unwrap();
    pending(Some(Failure::new(FailureKind::Install)))
        .write(&path)
        .unwrap();
    let files: Vec<_> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(files, ["pending-install.json"]);
}

#[test]
fn a_launch_on_the_old_version_reports_the_recorded_failure() {
    let path = record_path();
    let failure = Failure::io(&std::io::Error::from(
        std::io::ErrorKind::ReadOnlyFilesystem,
    ));
    pending(Some(failure.clone())).write(&path).unwrap();
    let report = PendingInstall::take(&path, "2026.1106.1", None).unwrap();
    assert_eq!(
        report.outcome,
        Outcome::InstallFailed {
            from_version: "2026.1106.1".into(),
            target_version: "2026.1119.1".into(),
            trigger: Trigger::Quit,
            failure,
        }
    );
}

#[test]
fn an_install_that_ended_without_a_result_is_interrupted() {
    let path = record_path();
    pending(None).write(&path).unwrap();
    let report = PendingInstall::take(&path, "2026.1106.1", None).unwrap();
    assert!(matches!(
        report.outcome,
        Outcome::InstallFailed {
            failure: Failure {
                kind: FailureKind::Interrupted,
                ..
            },
            ..
        }
    ));
}

#[test]
fn an_unreadable_record_is_removed_without_a_report() {
    let path = record_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"{").unwrap();
    assert_eq!(PendingInstall::take(&path, "1.0.0", None), None);
    assert!(!path.exists());
}

#[test]
fn reports_serialize_to_the_frontend_contract() {
    let report = Report {
        started_at_ms: 1_700_000_000_000,
        duration_ms: 1200,
        current_version: "2026.1106.1".into(),
        bundle_location: Some(BundleLocation::Translocated),
        outcome: Outcome::DownloadFailed {
            target_version: "2026.1119.1".into(),
            download_ms: 900,
            failure: Failure {
                kind: FailureKind::Request,
                io_kind: None,
                http_status: Some(404),
            },
            consecutive_failures: 2,
        },
    };
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        serde_json::json!({
            "startedAtMs": 1_700_000_000_000u64,
            "durationMs": 1200,
            "currentVersion": "2026.1106.1",
            "bundleLocation": "translocated",
            "outcome": {
                "kind": "download_failed",
                "target_version": "2026.1119.1",
                "download_ms": 900,
                "failure": { "kind": "request", "io_kind": null, "http_status": 404 },
                "consecutive_failures": 2,
            },
        })
    );
}

/// UPDATE_NATIVE_DIAGNOSTIC_TYPES=1 cargo test ... diagnostic_wire_types
#[test]
fn diagnostic_wire_types() {
    let generated = specta_typescript::Typescript::default()
        .export(
            &specta::Types::default().register::<Report>(),
            specta_serde::Format,
        )
        .expect("export native update wire types");
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/observability/generated/native-update.ts");
    if std::env::var_os("UPDATE_NATIVE_DIAGNOSTIC_TYPES").is_some() {
        std::fs::write(&output, &generated).expect("write types");
    }
    assert_eq!(
        std::fs::read_to_string(output).expect("generated types"),
        generated
    );
}
