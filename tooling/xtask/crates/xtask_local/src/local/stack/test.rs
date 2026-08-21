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

#[test]
fn compares_binary_contents_not_just_size() {
    let root = std::env::temp_dir().join(format!("macro-stack-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let left = root.join("left");
    let right = root.join("right");
    std::fs::write(&left, b"same").unwrap();
    std::fs::write(&right, b"same").unwrap();
    assert!(files_equal(&left, &right).unwrap());
    std::fs::write(&right, b"diff").unwrap();
    assert!(!files_equal(&left, &right).unwrap());
    std::fs::remove_dir_all(root).unwrap();
}
