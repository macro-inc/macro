#[test]
fn approval_rechecks_current_and_legacy_workflows() {
    let output = std::process::Command::new("node")
        .args(["--test", "ios_release_watch.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .env_remove("BASH_ENV")
        .output()
        .expect("run iOS release watcher scenarios with Node");

    assert!(
        output.status.success(),
        "iOS release watcher scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
