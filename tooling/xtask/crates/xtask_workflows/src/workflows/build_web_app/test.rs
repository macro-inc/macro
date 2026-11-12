use std::os::unix::fs::PermissionsExt;

use super::*;

#[test]
fn build_uses_remote_sccache_and_wasm_cache() {
    let yaml = build_web_app().to_string().expect("workflow yaml");
    let job = yaml.split("\n  build:\n").nth(1).expect("build job");
    assert!(
        job.contains("nsc cache sccache setup --cache_name web-ci"),
        "build must use the shared web-ci remote sccache: {job}"
    );
    let configure = job
        .find("nsc cache sccache setup")
        .expect("remote cache configuration");
    let start = job
        .find("run: sccache --start-server")
        .expect("start the server in a separate step with the exported credentials");
    let build_command = job.find("just build-").expect("web build command");
    assert!(configure < start && start < build_command);
    assert!(
        job.contains(".wasm-pack"),
        "build must persist wasm-pack's wasm-opt cache: {job}"
    );
    assert!(
        job.contains("just build-${{ inputs.environment }}"),
        "build still runs via just: {job}"
    );
}

#[test]
fn build_reuses_wasm_packages_only_from_the_actions_cache() {
    let yaml = build_web_app().to_string().expect("workflow yaml");
    let job = yaml.split("\n  build:\n").nth(1).expect("build job");
    assert!(
        job.contains(&format!(
            "WASM_PKG_CACHE_DIR: {}",
            vars::DEPLOY_WASM_PKG_CACHE_DIR
        )),
        "deploys reuse unchanged wasm packages: {job}"
    );
    // PR jobs write the Namespace HTTP cache and the cache volume; a deploy
    // must read neither.
    assert!(!job.contains("WASM_PKG_HTTP_CACHE"), "{job}");
    let mount = job
        .split("- name: Mount Namespace cache volume")
        .nth(1)
        .and_then(|rest| rest.split("\n    - ").next())
        .expect("volume mount step");
    let mounted: Vec<&str> = mount
        .lines()
        .map(|line| line.trim().trim_start_matches("path: |-").trim())
        .filter(|line| line.starts_with('/'))
        .collect();
    assert!(!mounted.is_empty(), "{mount}");
    for path in mounted {
        assert!(
            !vars::DEPLOY_WASM_PKG_CACHE_DIR.starts_with(path),
            "the deploy's packages must stay off the PR-writable volume ({path}): {mount}"
        );
    }

    let restore = job.find("actions/cache/restore@").expect("restore step");
    let wasm = job.find("just build-wasm").expect("wasm packages step");
    let save = job.find("actions/cache/save@").expect("save step");
    let build = job
        .find("just build-${{ inputs.environment }}")
        .expect("app build");
    assert!(
        restore < wasm && wasm < save && save < build,
        "packages are saved before the app build, so a failed one keeps them: {job}"
    );
    assert!(
        job.contains("RESTORED_KEY: ${{ steps.restore-wasm.outputs.cache-matched-key }}"),
        "the wasm step knows what was restored: {job}"
    );
    assert!(
        job.contains("if: steps.wasm.outputs.key != ''"),
        "the wasm step decides whether the set is new: {job}"
    );
}

/// Runs the wasm packages step with `just` replaced by `build`, a shell
/// snippet run in the cache directory, and returns what is left there and
/// the save key it wrote, if any.
fn run_wasm_step(
    entries: &[&str],
    restored_key: &str,
    build: &str,
) -> (Vec<String>, Option<String>) {
    let dir = tempfile::tempdir().expect("temp dir");
    let cache = dir.path().join("cache");
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).expect("bin dir");
    for entry in entries {
        std::fs::create_dir_all(cache.join(entry)).expect("entry");
        // Saved more than a week ago, so cached-wasm-build.sh would prune it.
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(10 * 24 * 3600);
        std::fs::File::open(cache.join(entry))
            .and_then(|file| file.set_modified(old))
            .expect("age entry");
    }
    let just = bin.join("just");
    std::fs::write(
        &just,
        format!("#!/usr/bin/env bash\nset -e\nsleep 0.05\nmkdir -p \"$WASM_PKG_CACHE_DIR\"\ncd \"$WASM_PKG_CACHE_DIR\"\n{build}\n"),
    )
    .expect("fake just");
    std::fs::set_permissions(&just, std::fs::Permissions::from_mode(0o755)).expect("chmod just");
    let output = dir.path().join("output");
    let status = std::process::Command::new("bash")
        .arg("-c")
        .arg(include_str!("../scripts/deploy_build_wasm.sh"))
        .env(
            "PATH",
            format!(
                "{}:{}",
                bin.display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .env("WASM_PKG_CACHE_DIR", &cache)
        .env("GITHUB_OUTPUT", &output)
        .env("GITHUB_RUN_ID", "7")
        .env("GITHUB_RUN_ATTEMPT", "1")
        .env("KEY_PREFIX", WASM_PACKAGES_KEY_PREFIX)
        .env("RESTORED_KEY", restored_key)
        .status()
        .expect("run the wasm step");
    assert!(status.success());
    let mut left: Vec<String> = std::fs::read_dir(&cache)
        .expect("cache dir")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    left.sort();
    let key = std::fs::read_to_string(&output)
        .unwrap_or_default()
        .lines()
        .find_map(|line| line.strip_prefix("key=").map(str::to_owned));
    (left, key)
}

#[test]
fn wasm_step_keeps_the_packages_it_used_and_names_new_sets() {
    // A reused entry is touched, a rebuilt one stored, an unused one dropped,
    // and the restored entries survive the week-old pruning until looked up.
    let (left, key) = run_wasm_step(
        &["a-1", "b-2", ".tmp-x"],
        "deploy-wasm-pkgs-v1-old-3-1",
        // Another package's store prunes before this one is looked up.
        "find . -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} +\ntest -d a-1\ntouch a-1\nmkdir c-3",
    );
    assert_eq!(left, ["a-1", "c-3"]);
    let key = key.expect("a new set is saved");
    assert!(
        key.starts_with(WASM_PACKAGES_KEY_PREFIX) && key.ends_with("-7-1"),
        "{key}"
    );

    // The same set again, restored from the entry that holds it: no save.
    let set = key.trim_end_matches("7-1");
    let (left, key) = run_wasm_step(&["a-1", "c-3"], &format!("{set}5-2"), "touch a-1 c-3");
    assert_eq!(left, ["a-1", "c-3"]);
    assert_eq!(key, None);
}

#[test]
fn wasm_step_drops_a_failed_restore() {
    // Nothing restored: whatever a failed extraction left is not reused.
    let (left, key) = run_wasm_step(&["a-1"], "", "test ! -e a-1\nmkdir a-1");
    assert_eq!(left, ["a-1"]);
    assert!(key.is_some());
}
