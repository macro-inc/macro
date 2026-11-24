use super::*;

fn rendered() -> String {
    build_cef_codecs()
        .to_string()
        .expect("workflow should serialize")
}

#[test]
fn builds_on_the_large_mac_runner_without_cancelling() {
    let yaml = rendered();
    assert!(yaml.contains("nscloud-macos-sequoia-arm64-12x28"), "{yaml}");
    assert!(yaml.contains("cancel-in-progress: false"), "{yaml}");
    assert!(yaml.contains("contents: write"), "{yaml}");
}

#[test]
fn builds_with_proprietary_codecs() {
    let yaml = rendered();
    assert!(yaml.contains("proprietary_codecs=true"), "{yaml}");
    assert!(yaml.contains("ffmpeg_branding=Chrome"), "{yaml}");
    // make_distrib takes the macOS framework from cefclient.app.
    assert!(yaml.contains("--build-target=cefclient"), "{yaml}");
    assert!(yaml.contains("--prerelease --latest=false"), "{yaml}");
}

#[test]
fn builds_each_mac_architecture_in_its_own_job() {
    let yaml = rendered();
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("workflow YAML");
    for (job, arch) in [("build-cef", "aarch64"), ("build-cef-x86_64", "x86_64")] {
        let steps = workflow["jobs"][job]["steps"]
            .as_sequence()
            .unwrap_or_else(|| panic!("{job} steps in:\n{yaml}"));
        let archs: Vec<&str> = steps
            .iter()
            .filter_map(|step| step["env"]["CEF_ARCH"].as_str())
            .collect();
        assert_eq!(archs, [arch], "{job}");
    }
    // Chromium cross-compiles x64 on the Apple silicon runner; without
    // CEF_ENABLE_AMD64 CEF's gn_args.py writes no x64 configuration there.
    assert!(yaml.contains("--x64-build"), "{yaml}");
    assert!(yaml.contains("export CEF_ENABLE_AMD64=1"), "{yaml}");
}

fn repository() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn codecs_manifest() -> serde_json::Value {
    let path = repository().join("apps/web/tauri/desktop-cef/cef-codecs.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("cef-codecs.json"))
        .expect("cef-codecs.json is JSON")
}

/// Runs the build script against the repository's manifest with `gh` stubbed
/// to report `published` as the release's only asset. Every path these tests
/// take exits before anything is checked out or built.
fn run_script(arch: &str, published: &str) -> (std::process::Output, String) {
    run_script_in(&repository(), arch, published)
}

/// [`run_script`] in `root`, which holds the manifest the script reads.
fn run_script_in(
    root: &std::path::Path,
    arch: &str,
    published: &str,
) -> (std::process::Output, String) {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().expect("script fixture directory");
    let bin = temp.path().join("bin");
    std::fs::create_dir(&bin).expect("mock command directory");
    let gh = bin.join("gh");
    std::fs::write(
        &gh,
        "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$STUB_GH_LOG\"\n[[ \"$1 $2\" == 'release view' ]] && printf '%s\\n' \"$STUB_PUBLISHED\"\n",
    )
    .expect("mock gh");
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).expect("executable gh");
    let output = std::process::Command::new("bash")
        .args([
            "-c",
            "export PATH=\"$STUB_BIN:$PATH\"\nexec bash \"$STUB_SCRIPT\"",
        ])
        .current_dir(root)
        .env("STUB_BIN", &bin)
        .env(
            "STUB_SCRIPT",
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/workflows/scripts/build_cef_codecs.sh"),
        )
        .env("STUB_GH_LOG", temp.path().join("gh.log"))
        .env("STUB_PUBLISHED", published)
        .env("CEF_ARCH", arch)
        .env("GITHUB_REPOSITORY", "macro-inc/macro")
        .env("RUNNER_TEMP", temp.path())
        .output()
        .expect("run the CEF build script");
    let calls = std::fs::read_to_string(temp.path().join("gh.log")).unwrap_or_default();
    (output, calls)
}

#[test]
fn an_architecture_without_a_manifest_entry_builds_nothing() {
    let manifest = codecs_manifest();
    if manifest["assets"].get("x86_64").is_some() {
        // The Intel entry has landed; the published-asset case below covers it.
        return;
    }
    let (output, calls) = run_script("x86_64", "");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{output:?}");
    assert!(
        stdout.contains("lists no x86_64 asset; nothing to build"),
        "{stdout}"
    );
    assert_eq!(calls, "", "nothing may reach GitHub: {calls}");
}

#[test]
fn a_published_asset_builds_nothing() {
    let manifest = codecs_manifest();
    let asset = manifest["assets"]["aarch64"]["asset"]
        .as_str()
        .expect("the Apple silicon asset");
    let (output, calls) = run_script("aarch64", asset);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{output:?}");
    assert!(stdout.contains("nothing to build"), "{stdout}");
    assert!(
        calls.lines().all(|line| line.starts_with("release view ")),
        "only the asset lookup may reach GitHub: {calls}"
    );
}

#[test]
fn only_a_completed_upload_counts_as_published() {
    let manifest = codecs_manifest();
    let asset = manifest["assets"]["aarch64"]["asset"]
        .as_str()
        .expect("the Apple silicon asset");
    let (_, calls) = run_script("aarch64", asset);
    assert!(
        calls.contains(r#"select(.state == "uploaded")"#),
        "an asset left in the starter state must not skip the build: {calls}"
    );
    let script = include_str!("../scripts/build_cef_codecs.sh");
    assert!(
        script.contains("--clobber"),
        "the retry replaces a starter asset"
    );
}

#[test]
fn architectures_sharing_an_asset_name_fail() {
    let root = tempfile::tempdir().expect("manifest fixture directory");
    let dir = root.path().join("apps/web/tauri/desktop-cef");
    std::fs::create_dir_all(&dir).expect("manifest directory");
    let mut manifest = codecs_manifest();
    let asset = manifest["assets"]["aarch64"]["asset"].clone();
    manifest["assets"]["x86_64"] = serde_json::json!({ "asset": asset, "sha256": "" });
    std::fs::write(
        dir.join("cef-codecs.json"),
        serde_json::to_string(&manifest).expect("manifest JSON"),
    )
    .expect("manifest");
    let (output, calls) = run_script_in(root.path(), "x86_64", "");
    assert!(!output.status.success(), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("for more than one architecture"),
        "{output:?}"
    );
    assert_eq!(calls, "", "nothing may reach GitHub: {calls}");
}
