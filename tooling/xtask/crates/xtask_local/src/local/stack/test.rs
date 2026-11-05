use super::*;

/// `up` writes stack.json and `update`/`status` read it back — the record and
/// the mode labels must stay in agreement.
#[test]
fn stack_state_roundtrips() {
    let state = StackState {
        mode: "local".to_string(),
        frontend: "static".to_string(),
        binaries_dir: Some(PathBuf::from("/tmp/binaries")),
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
        },
    )
    .unwrap();
    assert!(read_state(&instance).is_some());
    clear_state(&instance).unwrap();
    assert!(read_state(&instance).is_none());
    clear_state(&instance).unwrap();
    let _ = std::fs::remove_dir_all(instance.artifact_dir());
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
