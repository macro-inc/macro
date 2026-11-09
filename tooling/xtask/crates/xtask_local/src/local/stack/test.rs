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

mod replace_running_config {
    use std::cell::Cell;
    use std::path::PathBuf;

    use anyhow::bail;

    use super::super::replace_running_config;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xtask-replace-config-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("proxy/Caddyfile")
    }

    #[test]
    fn an_unchanged_config_reloads_nothing() {
        let path = scratch("unchanged");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "same").unwrap();
        let reloads = Cell::new(0);
        replace_running_config(&path, "same", false, || {
            reloads.set(reloads.get() + 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(reloads.get(), 0);
    }

    #[test]
    fn a_changed_config_is_written_then_reloaded() {
        let path = scratch("changed");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old").unwrap();
        replace_running_config(&path, "new", false, || {
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
            Ok(())
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn a_dry_run_leaves_the_old_config() {
        let path = scratch("dry-run");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old").unwrap();
        let reloads = Cell::new(0);
        replace_running_config(&path, "new", true, || {
            reloads.set(reloads.get() + 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(reloads.get(), 1, "the dry run still prints the reload");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
    }

    /// Otherwise the next update would find the new file, skip the reload and
    /// leave the proxy on the old rules.
    #[test]
    fn a_failed_reload_restores_the_old_config() {
        let path = scratch("failed");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old").unwrap();
        let result = replace_running_config(&path, "new", false, || bail!("compose failed"));
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");

        let fresh = scratch("failed-fresh");
        let result = replace_running_config(&fresh, "new", false, || bail!("compose failed"));
        assert!(result.is_err());
        assert!(!fresh.exists());
    }
}
