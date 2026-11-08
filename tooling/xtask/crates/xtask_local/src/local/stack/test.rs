use super::*;

/// `up` writes stack.json and `update`/`status` read it back — the record and
/// the mode labels must stay in agreement.
#[test]
fn stack_state_roundtrips() {
    let state = StackState {
        mode: "local".to_string(),
        frontend: "static".to_string(),
        binaries_dir: Some(PathBuf::from("/tmp/binaries")),
        shares_bundle: false,
        no_doppler: true,
        env_file: None,
        egress_url: None,
        preview_ssh_host: None,
        traces_enabled: false,
    };
    let json = serde_json::to_string(&state).unwrap();
    let back: StackState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.mode, "local");
    assert_eq!(back.frontend, "static");
    assert_eq!(back.binaries_dir, Some(PathBuf::from("/tmp/binaries")));
    assert!(mode_from_label(&back.mode).is_ok());
    assert!(mode_from_label("nonsense").is_err());
}

#[test]
fn legacy_stack_state_has_no_binaries_dir() {
    let state: StackState =
        serde_json::from_str(r#"{"mode":"local","frontend":"static"}"#).unwrap();
    assert_eq!(state.binaries_dir, None);
}

#[test]
fn clearing_state_invalidates_a_previous_headless_stack() {
    let instance =
        Instance::derive(Some(&format!("state-clear-{}", std::process::id())), None).unwrap();
    write_state(
        &instance,
        &StackState {
            mode: "local".to_string(),
            frontend: "static".to_string(),
            binaries_dir: None,
            shares_bundle: false,
            no_doppler: false,
            env_file: None,
            egress_url: None,
            preview_ssh_host: None,
            traces_enabled: true,
        },
    )
    .unwrap();
    assert!(read_state(&instance).is_some());
    clear_state(&instance).unwrap();
    assert!(read_state(&instance).is_none());
    clear_state(&instance).unwrap();
    let _ = std::fs::remove_dir_all(instance.artifact_dir());
}

/// A stack brought up by an older `stack up` keeps working after an upgrade.
#[test]
fn state_without_newer_fields_still_serves_its_bundle() {
    let state: StackState =
        serde_json::from_str(r#"{"mode":"local","frontend":"static"}"#).unwrap();
    assert!(state.serves_bundle());
    assert!(!state.no_doppler);
    assert!(state.traces_enabled);
}

fn phase_inputs() -> PhaseInputs {
    PhaseInputs {
        job: Some((JobKind::Up, JobStatus::Succeeded, false)),
        recorded: true,
        any_container_running: true,
        backend_healthy: true,
        frontend_healthy: true,
    }
}

#[test]
fn phase_is_ready_only_with_a_healthy_backend_and_frontend() {
    assert_eq!(derive_phase(phase_inputs()), Phase::Ready);
    assert_eq!(
        derive_phase(PhaseInputs {
            backend_healthy: false,
            ..phase_inputs()
        }),
        Phase::Degraded
    );
    assert_eq!(
        derive_phase(PhaseInputs {
            frontend_healthy: false,
            ..phase_inputs()
        }),
        Phase::Degraded
    );
}

#[test]
fn phase_distinguishes_a_live_bring_up_from_a_dead_one() {
    assert_eq!(
        derive_phase(PhaseInputs {
            job: Some((JobKind::Up, JobStatus::Running, true)),
            ..phase_inputs()
        }),
        Phase::Starting
    );
    assert_eq!(
        derive_phase(PhaseInputs {
            job: Some((JobKind::Up, JobStatus::Running, false)),
            ..phase_inputs()
        }),
        Phase::Failed
    );
    assert_eq!(
        derive_phase(PhaseInputs {
            job: Some((JobKind::Up, JobStatus::Failed, false)),
            ..phase_inputs()
        }),
        Phase::Failed
    );
}

/// A failed rebuild leaves the old build serving, so the stack is still usable.
#[test]
fn a_failed_rebuild_does_not_fail_the_stack() {
    assert_eq!(
        derive_phase(PhaseInputs {
            job: Some((JobKind::Rebuild, JobStatus::Failed, false)),
            ..phase_inputs()
        }),
        Phase::Ready
    );
}

#[test]
fn phase_reports_stopped_and_unrecorded_stacks() {
    assert_eq!(
        derive_phase(PhaseInputs {
            any_container_running: false,
            ..phase_inputs()
        }),
        Phase::Stopped
    );
    assert_eq!(
        derive_phase(PhaseInputs {
            recorded: false,
            job: None,
            ..phase_inputs()
        }),
        Phase::Unrecorded
    );
}
