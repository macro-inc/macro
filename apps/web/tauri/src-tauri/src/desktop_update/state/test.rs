use super::*;

#[test]
fn disabled_and_busy_states_never_start_another_download() {
    assert!(!State::<()>::new(false).begin_check());
    let mut state = State::new(true);
    assert!(state.begin_check());
    assert!(!state.begin_check());
    state.downloaded("2.5.1".into(), ());
    assert!(!state.begin_check());
}

#[test]
fn quit_during_download_does_not_install_partial_bytes() {
    let mut state = State::<()>::new(true);
    state.begin_check();
    state.status = Status::Downloading {
        version: "2.5.1".into(),
    };
    assert!(state.begin_install().is_none());
    assert!(!state.is_installing());
}

#[test]
fn verified_update_can_only_be_installed_once() {
    let mut state = State::new(true);
    state.downloaded("2.5.1".into(), vec![1, 2, 3]);
    assert_eq!(state.begin_install(), Some(vec![1, 2, 3]));
    assert!(state.is_installing());
    assert!(state.begin_install().is_none());
    assert!(!state.begin_check());
    state.finish_exit();
    assert!(!state.is_installing());
    assert!(!state.begin_check());
}

#[test]
fn failed_checks_can_retry() {
    let mut state = State::<()>::new(true);
    state.begin_check();
    state.status = Status::Error {
        message: "offline".into(),
    };
    assert!(state.begin_check());
}

#[test]
fn snapshots_serialize_to_the_frontend_contract() {
    let mut state = State::new(true);
    state.failed_install_version = Some("2026.1119.1".into());
    state.downloaded("2026.1119.1".into(), ());
    assert_eq!(
        serde_json::to_value(state.snapshot()).unwrap(),
        serde_json::json!({
            "status": "Ready",
            "data": { "version": "2026.1119.1" },
            "failedInstallVersion": "2026.1119.1",
        })
    );
    assert_eq!(
        serde_json::to_value(Snapshot::disabled()).unwrap(),
        serde_json::json!({ "status": "Disabled", "failedInstallVersion": null })
    );
}

/// UPDATE_NATIVE_UPDATE_STATUS_TYPES=1 cargo test ... native_update_status_wire_types
#[test]
fn native_update_status_wire_types() {
    let generated = specta_typescript::Typescript::default()
        .export(
            &specta::Types::default().register::<Snapshot>(),
            specta_serde::Format,
        )
        .expect("export native update status types");
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/lib/tauri/generated/native-update-status.ts");
    if std::env::var_os("UPDATE_NATIVE_UPDATE_STATUS_TYPES").is_some() {
        std::fs::create_dir_all(output.parent().unwrap()).expect("create generated directory");
        std::fs::write(&output, &generated).expect("write types");
    }
    assert_eq!(
        std::fs::read_to_string(output).expect("generated types"),
        generated
    );
}
