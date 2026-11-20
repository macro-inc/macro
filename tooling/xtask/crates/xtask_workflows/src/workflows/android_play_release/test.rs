/// The Android and iOS preconditions end with the same step, which waits for
/// the PR's other checks.
#[test]
fn a_release_waits_for_the_other_checks_and_not_for_the_other_store() {
    let output = std::process::Command::new("node")
        .args(["--test", "release_wait_for_checks.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .env_remove("BASH_ENV")
        .output()
        .expect("run the release wait scenarios with Node");

    assert!(
        output.status.success(),
        "release wait scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
