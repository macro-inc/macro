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

const WEEK_AND_A_HALF: std::time::Duration = std::time::Duration::from_secs(10 * 24 * 3600);

fn age(path: &std::path::Path) {
    std::fs::File::open(path)
        .and_then(|file| file.set_modified(std::time::SystemTime::now() - WEEK_AND_A_HALF))
        .expect("age path");
}

fn write_executable(path: &std::path::Path, script: &str) {
    std::fs::write(path, format!("#!/usr/bin/env bash\nset -e\n{script}\n")).expect("write stub");
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("chmod stub");
}

/// One run of the wasm packages step: `just` runs `build`, a shell snippet, in
/// the cache directory, `stubs` replace other commands, and `env` is added.
struct WasmStep<'a> {
    entries: &'a [&'a str],
    restored_key: &'a str,
    build: &'a str,
    stubs: &'a [(&'a str, &'a str)],
    env: &'a [(&'a str, &'a std::ffi::OsStr)],
}

impl WasmStep<'_> {
    fn new<'a>(entries: &'a [&'a str], restored_key: &'a str, build: &'a str) -> WasmStep<'a> {
        WasmStep {
            entries,
            restored_key,
            build,
            stubs: &[],
            env: &[],
        }
    }

    /// What is left in the cache directory, and the save key, if any.
    fn run(&self) -> (Vec<String>, Option<String>) {
        let dir = tempfile::tempdir().expect("temp dir");
        let cache = dir.path().join("cache");
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).expect("bin dir");
        for entry in self.entries {
            std::fs::create_dir_all(cache.join(entry)).expect("entry");
            // Saved more than a week ago, so cached-wasm-build.sh would prune it.
            age(&cache.join(entry));
        }
        write_executable(
            &bin.join("just"),
            &format!(
                "sleep 0.05\nmkdir -p \"$WASM_PKG_CACHE_DIR\"\ncd \"$WASM_PKG_CACHE_DIR\"\n{}",
                self.build
            ),
        );
        for (name, script) in self.stubs {
            write_executable(&bin.join(name), script);
        }
        let output = dir.path().join("output");
        let mut command = std::process::Command::new("bash");
        command
            .arg("-c")
            .arg(include_str!("../scripts/deploy_build_wasm.sh"))
            // CI's dev shell sets BASH_ENV, which puts the real tools back in
            // front of the stubs.
            .env_remove("BASH_ENV")
            .env(
                "PATH",
                std::env::join_paths(std::iter::once(bin.to_path_buf()).chain(
                    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
                ))
                .expect("stub directory joins the inherited PATH"),
            )
            .env("WASM_PKG_CACHE_DIR", &cache)
            .env("GITHUB_OUTPUT", &output)
            .env("GITHUB_RUN_ID", "7")
            .env("GITHUB_RUN_ATTEMPT", "1")
            .env("KEY_PREFIX", WASM_PACKAGES_KEY_PREFIX)
            .env("RESTORED_KEY", self.restored_key);
        for (name, value) in self.env {
            command.env(name, value);
        }
        assert!(command.status().expect("run the wasm step").success());
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
}

#[test]
fn wasm_step_keeps_the_packages_it_used_and_names_new_sets() {
    // A reused entry is touched, a rebuilt one stored, an unused one dropped,
    // and the restored entries survive the week-old pruning until looked up.
    let (left, key) = WasmStep::new(
        &["a-1", "b-2"],
        "deploy-wasm-pkgs-v1-old-3-1",
        // Another package's store prunes before this one is looked up, and a
        // store it left unfinished is dropped too.
        "find . -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} +\ntest -d a-1\ntouch a-1\nmkdir c-3 .tmp-x",
    )
    .run();
    assert_eq!(left, ["a-1", "c-3"]);
    let key = key.expect("a new set is saved");
    assert!(
        key.starts_with(WASM_PACKAGES_KEY_PREFIX) && key.ends_with("-7-1"),
        "{key}"
    );

    // The same set again, restored from the entry that holds it: no save.
    let set = key.trim_end_matches("7-1");
    let restored = format!("{set}5-2");
    let (left, key) = WasmStep::new(&["a-1", "c-3"], &restored, "touch a-1 c-3").run();
    assert_eq!(left, ["a-1", "c-3"]);
    assert_eq!(key, None);
}

#[test]
fn wasm_step_drops_a_failed_restore() {
    // Nothing restored: whatever a failed extraction left is not reused.
    let (left, key) = WasmStep::new(&["a-1"], "", "test ! -e a-1\nmkdir a-1").run();
    assert_eq!(left, ["a-1"]);
    assert!(key.is_some());
}

/// With the real `cached-wasm-build.sh`: a package reused from the restored
/// cache and one rebuilt into an out dir an earlier build left both stay in the
/// saved set, and the HTTP cache PR jobs write is never asked, though the job
/// has its credentials.
#[test]
fn wasm_step_with_the_real_package_cache() {
    let out = tempfile::tempdir().expect("out dir");
    // wasm-pack overwrites the files of an existing out dir, which leaves the
    // directory's own mtime old.
    let stale = out.path().join("a");
    std::fs::create_dir_all(&stale).expect("stale out dir");
    std::fs::write(stale.join("a.wasm"), "old").expect("old output");
    age(&stale);
    let curl_called = out.path().join("curl-called");
    let cached = xtask_paths::repo_root().join("apps/web/scripts/cached-wasm-build.sh");
    let build = format!(
        "for package in a b; do\n\
         \x20 {cached} \"$package\" \"$OUT/$package\" -- sh -c 'mkdir -p \"$1\" && echo new > \"$1/$2.wasm\"' _ \"$OUT/$package\" \"$package\"\n\
         done",
        cached = cached.display()
    );
    let (left, key) = WasmStep {
        stubs: &[
            // wasm-cache-key.ts
            ("bun", "echo k"),
            ("curl", "touch \"$CURL_CALLED\"\nexit 22"),
        ],
        env: &[
            ("OUT", out.path().as_os_str()),
            ("CURL_CALLED", curl_called.as_os_str()),
            ("SCCACHE_WEBDAV_ENDPOINT", "https://cache.invalid".as_ref()),
            ("SCCACHE_WEBDAV_TOKEN", "token".as_ref()),
        ],
        ..WasmStep::new(&["b-k"], "deploy-wasm-pkgs-v1-old-3-1", &build)
    }
    .run();
    assert_eq!(left, ["a-k", "b-k"]);
    assert!(key.is_some());
    assert!(!curl_called.exists(), "the deploy asked the HTTP cache");
}
