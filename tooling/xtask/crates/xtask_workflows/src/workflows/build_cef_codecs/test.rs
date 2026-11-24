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
    assert!(yaml.contains("  build-cef:\n"), "{yaml}");
    assert!(yaml.contains("  build-cef-x86_64:\n"), "{yaml}");
    assert!(yaml.contains("CEF_ARCH: aarch64"), "{yaml}");
    assert!(yaml.contains("CEF_ARCH: x86_64"), "{yaml}");
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
        .current_dir(repository())
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
