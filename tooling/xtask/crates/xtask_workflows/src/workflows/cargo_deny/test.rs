/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn the_advisories_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/cargo_deny_new_advisories.ts").contains("${{"));
}

#[test]
fn advisories_fail_a_pr_only_for_packages_it_adds() {
    let output = std::process::Command::new("node")
        .args(["--test", "cargo_deny_new_advisories.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .env_remove("BASH_ENV")
        .output()
        .expect("run the advisories script's tests with Node");

    assert!(
        output.status.success(),
        "advisories script tests failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
