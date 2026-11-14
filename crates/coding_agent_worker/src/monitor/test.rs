use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};

use harness_id::HarnessId;

use super::*;
use crate::config::{Config, ConfigError};

#[tokio::test]
async fn serve_refuses_a_socket_another_collector_answers() {
    let directory = tempfile::tempdir().unwrap();
    let socket = directory.path().join("monitor.sock");
    let _live = std::os::unix::net::UnixListener::bind(&socket).unwrap();

    assert!(matches!(claim(&socket), Ok(Claim::Served)));
    assert!(matches!(
        serve(Some(socket.clone()), false).await,
        Err(error) if error.to_string().contains("another collector already serves")
    ));
    assert!(answers(&socket), "the live socket is left in place");
}

#[tokio::test]
async fn serve_replaces_a_stale_socket() {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().join("home");
    std::fs::create_dir(&home).unwrap();
    std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
    let socket = home.join("monitor.sock");
    drop(std::os::unix::net::UnixListener::bind(&socket).unwrap());
    assert!(!answers(&socket), "nothing listens on the stale socket");

    let claimed = claim(&socket);
    assert!(
        matches!(claimed, Ok(Claim::Bound(_))),
        "a stale socket is replaced: {:?}",
        claimed.err()
    );

    assert!(answers(&socket));
    let metadata = std::fs::symlink_metadata(&socket).unwrap();
    assert!(metadata.file_type().is_socket());
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
}

#[test]
fn monitor_settings_default_when_the_table_or_file_is_missing() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("macrod.toml");
    assert_eq!(
        MonitorSettings::read(&missing).unwrap(),
        MonitorSettings {
            enabled: true,
            history_hours: 24,
            fps: 12,
            run_record_dirs: Vec::new(),
        }
    );

    // Only the table is read: a config without a harness is fine here.
    std::fs::write(&missing, "[update]\nauto = false\n").unwrap();
    assert_eq!(
        MonitorSettings::read(&missing).unwrap(),
        MonitorSettings::default()
    );
}

#[test]
fn a_partial_monitor_table_overrides_only_its_keys() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(
        &path,
        "[monitor]\nenabled = false\nrun_record_dirs = [\"/var/runs\"]\n",
    )
    .unwrap();

    assert_eq!(
        MonitorSettings::read(&path).unwrap(),
        MonitorSettings {
            enabled: false,
            history_hours: 24,
            fps: 12,
            run_record_dirs: vec![PathBuf::from("/var/runs")],
        }
    );
}

#[test]
fn the_monitor_table_rejects_unknown_keys() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, "[monitor]\nenabled = true\nsocket = \"/tmp/x\"\n").unwrap();
    assert!(matches!(
        MonitorSettings::read(&path),
        Err(ConfigError::Parse { .. })
    ));

    let full = format!(
        "{}\n[monitor]\nfrobnicate = 1\n",
        include_str!("../../config.example.toml")
    );
    assert!(toml::from_str::<Config>(&full).is_err());
}

#[test]
fn the_default_config_hosts_the_monitor() {
    let config: Config = toml::from_str(include_str!("../../default.macrod.toml")).unwrap();
    assert!(config.monitor.enabled);
}

#[tokio::test]
async fn a_serving_core_reports_until_it_stops() {
    let link = DaemonLink::new();
    let mut state = link.subscribe();
    let (connected, connected_rx) = watch::channel(false);
    let (open, open_rx) = watch::channel(0);

    let report = report_daemon(link, HarnessId::TEST_A, connected_rx, open_rx);
    connected.send_replace(true);
    open.send_replace(2);
    let reported = state
        .wait_for(|state| state.connected && state.open_prompts == 2)
        .await
        .unwrap()
        .clone();
    assert_eq!(reported.harness, Some(HarnessId::TEST_A));

    drop(report);
    let stopped = state
        .wait_for(|state| state.harness.is_none())
        .await
        .unwrap()
        .clone();
    assert_eq!(stopped, DaemonState::default());
}

#[test]
fn daemon_health_says_whether_the_runtime_is_connected() {
    let now = chrono::Utc::now();
    let idle = daemon_source::health(&DaemonState::default(), now);
    assert_eq!(
        idle.state,
        agent_monitor::domain::model::SourceState::Absent
    );

    let serving = DaemonState {
        harness: Some(HarnessId::TEST_A),
        connected: true,
        open_prompts: 3,
    };
    let healthy = daemon_source::health(&serving, now);
    assert_eq!(
        healthy.state,
        agent_monitor::domain::model::SourceState::Healthy
    );
    assert_eq!(healthy.items, 3);

    let offline = daemon_source::health(
        &DaemonState {
            connected: false,
            ..serving
        },
        now,
    );
    assert_eq!(
        offline.state,
        agent_monitor::domain::model::SourceState::Unhealthy
    );
}
