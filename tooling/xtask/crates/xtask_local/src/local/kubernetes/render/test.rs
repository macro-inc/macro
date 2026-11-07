use super::*;

#[test]
fn rendering_images_does_not_replace_the_running_instance_configuration() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("current time")
        .as_nanos();
    let state = std::env::temp_dir().join(format!("macro-render-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&state).expect("create test state");
    let running = state.join("test.json");
    let original = br#"{"name":"test","devBinaries":"/running/binaries","slot":1}"#;
    std::fs::write(&running, original).expect("record running configuration");
    let build = flake(
        &state,
        &json!({"name":"test", "devBinaries":null}),
        "push null",
    )
    .expect("render image build flake");
    let source = build.join("flake.nix");
    let original_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
    std::fs::File::options()
        .write(true)
        .open(&source)
        .expect("open flake")
        .set_times(std::fs::FileTimes::new().set_modified(original_time))
        .expect("set timestamp");
    flake(
        &state,
        &json!({"name":"test", "devBinaries":null}),
        "push null",
    )
    .expect("repeat identical image build");
    let retained_time = std::fs::metadata(source)
        .expect("flake metadata")
        .modified()
        .expect("timestamp");
    let retained = std::fs::read(&running).expect("running configuration remains");
    std::fs::remove_dir_all(state).expect("remove test state");
    assert_eq!(retained, original);
    assert_eq!(retained_time, original_time);
}

#[test]
fn source_cache_tracks_commits_and_working_tree_contents() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("current time")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("macro-source-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&root).expect("test directory");
    let git = |args: &[&str]| {
        let result = Command::new("git")
            .current_dir(&root)
            .args(args)
            .output()
            .expect("git");
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    git(&["init", "--initial-branch=fixture"]);
    git(&["config", "core.hooksPath", "/dev/null"]);
    git(&["config", "user.name", "Test"]);
    git(&["config", "user.email", "user@example.com"]);
    std::fs::write(root.join("source.nix"), "first").expect("source");
    git(&["add", "source.nix"]);
    git(&["commit", "-m", "test: initial snapshot"]);
    let initial = source_fingerprint(&root).expect("initial fingerprint");
    std::fs::write(root.join("untracked"), "not a Git flake input").expect("untracked file");
    assert_eq!(
        initial,
        source_fingerprint(&root).expect("untracked ignored")
    );
    std::fs::write(root.join("source.nix"), "second").expect("change source");
    let changed = source_fingerprint(&root).expect("changed fingerprint");
    assert_ne!(initial, changed);
    git(&["add", "source.nix"]);
    assert_eq!(
        changed,
        source_fingerprint(&root).expect("same staged contents")
    );
    std::fs::write(root.join("source.nix"), "third").expect("change staged source");
    assert_ne!(
        changed,
        source_fingerprint(&root).expect("new working contents")
    );
    git(&["add", "source.nix"]);
    let before_commit = source_fingerprint(&root).expect("before commit");
    git(&["commit", "-m", "test: next snapshot"]);
    assert_ne!(
        before_commit,
        source_fingerprint(&root).expect("new commit")
    );
    std::fs::remove_dir_all(root).expect("remove fixture");
}
