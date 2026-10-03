use super::*;

#[test]
fn namespace_sccache_masks_credentials_before_exporting_them() {
    let step = configure_namespace_sccache("test-cache");
    let condition = step
        .value
        .if_condition
        .as_ref()
        .expect("Namespace sccache credentials should be limited to trusted refs");
    let run = step
        .value
        .run
        .expect("Namespace sccache setup should be a run step");

    let mask = run
        .find("echo \"::add-mask::$v\"")
        .expect("credential values should be registered with GitHub's log masker");
    let export = run
        .find("cat \"$env_file\" >> \"$GITHUB_ENV\"")
        .expect("the generated sccache environment should be exported");

    assert!(mask < export, "credentials must be masked before export");
    assert!(run.contains("*TOKEN*|*SECRET*|*PASSWORD*"));
    assert!(run.contains("mktemp \"$RUNNER_TEMP/namespace-sccache.XXXXXX\""));
    assert!(run.contains("trap 'rm -f \"$env_file\"' EXIT"));
    assert!(run.contains("nsc cache sccache setup --cache_name test-cache"));
    assert!(
        condition
            .0
            .contains("github.event.pull_request.head.repo.full_name")
    );
    assert!(condition.0.contains("github.repository"));
}

#[test]
fn namespace_sccache_combines_job_specific_and_trust_conditions() {
    let step = configure_namespace_sccache_when("test-cache", "steps.filter.outputs.hit == 'true'");
    let condition = step
        .value
        .if_condition
        .expect("conditional Namespace sccache setup should have an if expression");

    assert!(
        condition
            .0
            .contains("github.event.pull_request.head.repo.full_name")
    );
    assert!(condition.0.contains("steps.filter.outputs.hit == 'true'"));
}

#[test]
fn named_dev_shell_passes_the_flake_attribute() {
    let step = setup_dev_shell_named("agent-daemon");
    let with = step.value.with.expect("named shell should set with.shell");
    assert_eq!(
        with.0.get("shell").and_then(|value| value.as_str()),
        Some("agent-daemon")
    );
}

#[test]
fn default_dev_shell_does_not_pass_a_shell_input() {
    let step = setup_dev_shell();
    assert!(
        step.value.with.is_none(),
        "unspecified shell must keep the action default so other workflows stay unchanged"
    );
}

/// Run the handoff download step against a fake `nsc` whose store holds one
/// `prebuilt-binaries.tar.gz` per attempt in `uploaded_attempts`, each
/// containing its attempt number. Returns the downloaded content on success.
fn download_handoff(run_attempt: u32, uploaded_attempts: &[u32]) -> Result<String, String> {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    for attempt in uploaded_attempts {
        let blob = store.join(format!("handoff/42-{attempt}/svc/prebuilt-binaries.tar.gz"));
        std::fs::create_dir_all(blob.parent().unwrap()).unwrap();
        std::fs::write(blob, attempt.to_string()).unwrap();
    }
    let bin = dir.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let nsc = bin.join("nsc");
    std::fs::write(
        &nsc,
        "#!/usr/bin/env bash\n\
         [[ \"$1 $2\" == \"artifact download\" ]] || exit 2\n\
         [[ -f \"$FAKE_STORE/$3\" ]] || { echo 'Failed: blob not found'; exit 1; }\n\
         cp \"$FAKE_STORE/$3\" \"$4\"\n",
    )
    .unwrap();
    let mut perms = std::fs::metadata(&nsc).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
    std::fs::set_permissions(&nsc, perms).unwrap();

    let runner_temp = dir.path().join("runner-temp");
    std::fs::create_dir(&runner_temp).unwrap();
    let script = download_handoff_artifacts("svc").value.run.unwrap();
    let output = std::process::Command::new("bash")
        .args(["-c", &format!("PATH=\"$FAKE_BIN:$PATH\"\n{script}")])
        .env("FAKE_BIN", &bin)
        .env("FAKE_STORE", &store)
        .env("RUNNER_TEMP", &runner_temp)
        .env("GITHUB_RUN_ID", "42")
        .env("GITHUB_RUN_ATTEMPT", run_attempt.to_string())
        .env("SERVICE", "svc")
        .env("HAS_BINARIES", "true")
        .env("HAS_LAMBDAS", "false")
        .output()
        .unwrap();
    if output.status.success() {
        Ok(std::fs::read_to_string(runner_temp.join("handoff/prebuilt-binaries.tar.gz")).unwrap())
    } else {
        Err(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

#[test]
fn handoff_download_falls_back_to_the_attempt_that_built_it() {
    assert_eq!(download_handoff(3, &[1]), Ok("1".to_string()));
}

#[test]
fn handoff_download_prefers_the_newest_attempt() {
    assert_eq!(download_handoff(3, &[1, 3]), Ok("3".to_string()));
    assert_eq!(download_handoff(1, &[1]), Ok("1".to_string()));
}

#[test]
fn handoff_download_fails_when_no_attempt_uploaded() {
    let stdout = download_handoff(2, &[]).unwrap_err();
    assert!(
        stdout.contains("::error::prebuilt-binaries.tar.gz for svc not found in attempts 1-2"),
        "{stdout}"
    );
}

#[test]
fn web_build_cache_volume_includes_wasm_pack_and_cargo() {
    let step = mount_web_build_cache_volume();
    let with = step.value.with.expect("cache volume should set paths");
    let path = with
        .0
        .get("path")
        .and_then(|value| value.as_str())
        .expect("path list");
    assert!(path.contains("/home/runner/.bun/install/cache"));
    assert!(path.contains("/home/runner/.cargo/registry"));
    assert!(path.contains("/home/runner/.cargo/git"));
    assert!(path.contains("/home/runner/.cache/.wasm-pack"));
    assert_eq!(
        with.0.get("cache").and_then(|value| value.as_str()),
        Some("nix")
    );
}
