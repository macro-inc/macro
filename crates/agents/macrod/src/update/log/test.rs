use super::*;

fn lines(path: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn each_event_is_one_json_line() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(".macrod/logs/update.log");
    let log = UpdateLog::at(path.clone(), MAX_BYTES);

    log.record(&UpdateEvent::Startup {
        version: "v2026.10.27.1".to_owned(),
        from_handoff: false,
    });
    log.record(&UpdateEvent::Check {
        current: "v2026.10.27.1".to_owned(),
        latest: Some("v2026.10.27.2".to_owned()),
        outcome: CheckOutcome::Newer,
    });
    log.record(&UpdateEvent::Download {
        version: "v2026.10.27.2".to_owned(),
        bytes: 20_971_520,
        checksum_ok: true,
        result: "staged".to_owned(),
    });
    log.record(&UpdateEvent::Apply {
        from: Some("v2026.10.27.1".to_owned()),
        to: "v2026.10.27.2".to_owned(),
        method: ApplyMethod::ExecveHandoff,
        active_prompts: 0,
        result: "restarting".to_owned(),
    });

    let mut written = lines(&path);
    for line in &mut written {
        let time = line
            .as_object_mut()
            .unwrap()
            .remove("time")
            .expect("every line is timestamped");
        assert!(
            chrono::DateTime::parse_from_rfc3339(time.as_str().unwrap()).is_ok(),
            "{time}"
        );
    }
    assert_eq!(
        written,
        [
            serde_json::json!({"event": "startup", "version": "v2026.10.27.1", "from_handoff": false}),
            serde_json::json!({"event": "check", "current": "v2026.10.27.1", "latest": "v2026.10.27.2", "outcome": "newer"}),
            serde_json::json!({"event": "download", "version": "v2026.10.27.2", "bytes": 20_971_520, "checksum_ok": true, "result": "staged"}),
            serde_json::json!({"event": "apply", "from": "v2026.10.27.1", "to": "v2026.10.27.2", "method": "execve-handoff", "active_prompts": 0, "result": "restarting"}),
        ]
    );
}

#[cfg(unix)]
#[test]
fn the_log_is_private_to_its_owner() {
    use std::os::unix::fs::PermissionsExt as _;

    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(".macrod/logs/update.log");
    UpdateLog::at(path.clone(), MAX_BYTES).record(&UpdateEvent::Startup {
        version: "v2026.10.27.1".to_owned(),
        from_handoff: true,
    });

    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&path), 0o600);
    assert_eq!(mode(path.parent().unwrap()), 0o700);
}

#[test]
fn a_full_log_rotates_keeping_one_previous_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("update.log");
    let log = UpdateLog::at(path.clone(), 200);
    let startup = |version: &str| UpdateEvent::Startup {
        version: version.to_owned(),
        from_handoff: false,
    };

    // Lines are about 90 bytes, so every third one takes the file past 200.
    for version in ["v1", "v2", "v3", "v4", "v5", "v6", "v7"] {
        log.record(&startup(version));
    }

    let version = |line: &serde_json::Value| line["version"].as_str().unwrap().to_owned();
    let current: Vec<_> = lines(&path).iter().map(version).collect();
    let previous: Vec<_> = lines(&root.path().join("update.log.1"))
        .iter()
        .map(version)
        .collect();
    assert_eq!(previous, ["v4", "v5", "v6"]);
    assert_eq!(current, ["v7"]);
    let files: Vec<_> = std::fs::read_dir(root.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(files.len(), 2, "{files:?}");
}
