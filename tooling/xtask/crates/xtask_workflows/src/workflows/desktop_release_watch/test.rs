/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn the_watch_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/desktop_release_watch.ts").contains("${{"));
}

#[test]
fn the_watch_checks_production_releases_for_their_installers() {
    let output = std::process::Command::new("node")
        .args(["--test", "desktop_release_watch.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .env_remove("BASH_ENV")
        .output()
        .expect("run the desktop release watch's tests with Node");

    assert!(
        output.status.success(),
        "desktop release watch tests failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
