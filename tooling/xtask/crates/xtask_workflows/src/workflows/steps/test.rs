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

#[test]
fn namespace_sccache_allows_a_slow_backend_check_at_startup() {
    let run = configure_namespace_sccache("test-cache")
        .value
        .run
        .expect("Namespace sccache setup should be a run step");

    let write = run
        .find("echo 'server_startup_timeout_ms = 60000' > \"$sccache_conf\"")
        .expect("the startup limit should be written to a config file");
    let export = run
        .find("echo \"SCCACHE_CONF=$sccache_conf\" >> \"$GITHUB_ENV\"")
        .expect("later steps should read the config file");
    let stop = run
        .find("sccache --stop-server")
        .expect("the server should restart with the new backend");

    assert!(write < export && export < stop);
}

/// The three workflows behind the required checks, with the job ids their collector
/// needs. A queue that waits on a check nobody reports never merges anything.
fn required_workflows() -> Vec<(&'static str, serde_yaml::Value)> {
    use crate::workflows::{
        code_check_cloud_storage::code_check_cloud_storage, code_check_infra::code_check_infra,
        web_app_check_main::web_app_check_main,
    };
    [
        ("Cloud Storage Status Check", code_check_cloud_storage()),
        ("Infra Status Check", code_check_infra()),
        ("Web App Status Check", web_app_check_main()),
    ]
    .into_iter()
    .map(|(name, workflow)| {
        let yaml = workflow.to_string().expect("workflow yaml");
        (name, serde_yaml::from_str(&yaml).expect("parsed workflow"))
    })
    .collect()
}

fn workflow_by_check(check: &str) -> serde_yaml::Value {
    required_workflows()
        .into_iter()
        .find(|(name, _)| *name == check)
        .expect("required check")
        .1
}

/// Run a required check's collector with these job results and return whether it
/// passed. Jobs not named are `skipped`.
fn collector_passes(
    check: &str,
    event: &str,
    outputs: &[(&str, &str)],
    results: &[(&str, &str)],
) -> bool {
    let workflow = workflow_by_check(check);
    let job = &workflow["jobs"]["status-check"];
    assert_eq!(job["name"].as_str(), Some(check), "the ruleset names this");
    let mut script = job["steps"][0]["run"].as_str().expect("script").to_owned();
    script = script.replace("${{ github.event_name }}", event);
    for (output, value) in outputs {
        script = script.replace(
            &format!("${{{{ needs.path-check.outputs.{output} }}}}"),
            value,
        );
    }
    for need in job["needs"].as_sequence().expect("needs") {
        let need = need.as_str().expect("job id");
        let result = results
            .iter()
            .find(|(id, _)| *id == need)
            .map_or("skipped", |(_, result)| *result);
        script = script.replace(&format!("${{{{ needs.{need}.result }}}}"), result);
    }
    assert!(!script.contains("${{"), "unresolved expression: {script}");
    std::process::Command::new("bash")
        .args(["-c", &script])
        .output()
        .expect("bash")
        .status
        .success()
}

#[test]
fn every_required_check_reports_to_the_merge_queue() {
    for (check, workflow) in required_workflows() {
        let triggers = &workflow["on"];
        assert_eq!(
            triggers["merge_group"]["types"][0].as_str(),
            Some("checks_requested"),
            "{check}"
        );
        assert!(!triggers["pull_request"].is_null(), "{check}");
        assert_eq!(
            workflow["jobs"]["status-check"]["if"].as_str(),
            Some("always()"),
            "{check} must report even when jobs skip"
        );
        let filter = workflow["jobs"]["path-check"]["steps"]
            .as_sequence()
            .expect("steps")
            .iter()
            .find(|step| step["id"].as_str() == Some("filter"))
            .expect("path filter")
            .clone();
        assert_eq!(
            filter["with"]["base"].as_str(),
            Some("${{ github.event.merge_group.base_sha }}"),
            "{check}: a merge group has no PR file list"
        );
        assert_eq!(
            filter["with"]["ref"].as_str(),
            Some("${{ github.event.merge_group.head_sha }}"),
            "{check}"
        );
    }
}

/// `github.ref` is unique per queue entry, so `cancel-in-progress` can't cancel one
/// entry's run from another's. A shared group would remove PRs from the queue.
#[test]
fn queue_entries_never_share_a_concurrency_group() {
    for (check, workflow) in required_workflows() {
        let group = workflow["concurrency"]["group"].as_str().expect("group");
        assert!(group.contains("${{ github.ref }}"), "{check}: {group}");
    }
}

#[test]
fn collectors_accept_skipped_jobs_on_a_pull_request() {
    for check in ["Cloud Storage Status Check", "Infra Status Check"] {
        assert!(collector_passes(
            check,
            "pull_request",
            &[("should_run", "false")],
            &[("path-check", "success")]
        ));
    }
    assert!(collector_passes(
        "Web App Status Check",
        "pull_request",
        &[("should_run", "false"), ("codegen_changed", "false")],
        &[
            ("path-check", "success"),
            ("android-native-check", "success")
        ],
    ));
}

#[test]
fn collectors_reject_failed_and_cancelled_jobs() {
    for (check, job) in [
        ("Cloud Storage Status Check", "test"),
        ("Infra Status Check", "check"),
        ("Web App Status Check", "build"),
    ] {
        for result in ["failure", "cancelled"] {
            for event in ["pull_request", "merge_group"] {
                assert!(
                    !collector_passes(
                        check,
                        event,
                        &[("should_run", "true"), ("codegen_changed", "false")],
                        &[
                            ("path-check", "success"),
                            ("android-native-check", "success"),
                            (job, result)
                        ],
                    ),
                    "{check} {event} {job} {result}"
                );
            }
        }
    }
}

#[test]
fn queue_collectors_reject_skipped_jobs_their_paths_selected() {
    for check in [
        "Cloud Storage Status Check",
        "Infra Status Check",
        "Web App Status Check",
    ] {
        assert!(
            !collector_passes(
                check,
                "merge_group",
                &[("should_run", "true"), ("codegen_changed", "false")],
                &[("path-check", "success")],
            ),
            "{check}"
        );
        assert!(
            collector_passes(
                check,
                "merge_group",
                &[("should_run", "false"), ("codegen_changed", "false")],
                &[("path-check", "success")],
            ),
            "{check}: the queue skips a workflow its paths didn't select"
        );
    }
    assert!(
        !collector_passes(
            "Web App Status Check",
            "merge_group",
            &[("should_run", "false"), ("codegen_changed", "true")],
            &[("path-check", "success")],
        ),
        "a schema change can't skip Generated Code Check in the queue"
    );
}

#[test]
fn queue_collectors_pass_when_everything_passes() {
    let cases: [(&str, &[&str]); 3] = [
        (
            "Cloud Storage Status Check",
            &["path-check", "check", "test"],
        ),
        (
            "Infra Status Check",
            &["path-check", "biome-check", "check"],
        ),
        (
            "Web App Status Check",
            &[
                "path-check",
                "typescript",
                "generated-code",
                "biome-check",
                "test",
                "cycles",
                "build",
            ],
        ),
    ];
    for (check, jobs) in cases {
        let results: Vec<(&str, &str)> = jobs.iter().map(|job| (*job, "success")).collect();
        assert!(
            collector_passes(
                check,
                "merge_group",
                &[("should_run", "true"), ("codegen_changed", "true")],
                &results,
            ),
            "{check}"
        );
    }
}

/// The native checks read a PR's labels, so they stay on the PR. The collector must
/// still demand Android's there.
#[test]
fn native_checks_stay_on_the_pull_request() {
    let workflow = workflow_by_check("Web App Status Check");
    for job in ["android-native-check", "ios-native-check"] {
        assert_eq!(
            workflow["jobs"][job]["if"].as_str(),
            Some(NOT_IN_MERGE_QUEUE),
            "{job}"
        );
    }
    assert!(!collector_passes(
        "Web App Status Check",
        "pull_request",
        &[("should_run", "false"), ("codegen_changed", "false")],
        &[("path-check", "success")],
    ));
}

/// Every narrowing on a PR relies on the queue testing the whole workspace.
#[test]
fn queue_selects_the_whole_workspace_and_builds_service_bins() {
    let dir = tempfile::tempdir().expect("temp dir");
    let output = dir.path().join("output");
    let script = include_str!("../scripts/compute_nextest_filter.sh");
    let status = std::process::Command::new("bash")
        .args(["-c", script])
        .env("GITHUB_EVENT_NAME", "merge_group")
        .env("GITHUB_OUTPUT", &output)
        .status()
        .expect("bash");
    assert!(status.success());
    let written = std::fs::read_to_string(&output).expect("outputs");
    assert_eq!(written, "rust_packages=all\nskip_tests=false\n");

    let workflow = workflow_by_check("Cloud Storage Status Check");
    let steps = workflow["jobs"]["test"]["steps"]
        .as_sequence()
        .expect("steps");
    let build = steps
        .iter()
        .find(|step| step["name"].as_str() == Some("build service binaries"))
        .expect("build step");
    assert_eq!(build["if"].as_str(), Some(IN_MERGE_QUEUE));
    assert!(build["run"].as_str().expect("script").contains("--bins"));
}

/// A narrower PR rule for Generated Code Check mustn't apply in the queue, or a schema
/// change a PR skipped reaches `main` stale. The filter's own answer covers every Rust
/// source; a step replacing it must say what it does in the queue.
#[test]
fn queue_runs_generated_code_check_for_any_rust_change() {
    let workflow = workflow_by_check("Web App Status Check");
    let path_check = &workflow["jobs"]["path-check"];
    let output = path_check["outputs"]["codegen_changed"]
        .as_str()
        .expect("output");
    let steps = path_check["steps"].as_sequence().expect("steps");
    if output.contains("steps.filter.") {
        let filter = steps
            .iter()
            .find(|step| step["id"].as_str() == Some("filter"))
            .expect("filter");
        let filters = filter["with"]["filters"].as_str().expect("filters");
        let codegen = filters
            .split("codegen_changed:")
            .nth(1)
            .expect("codegen filter");
        assert!(codegen.contains("crates/**"), "{codegen}");
        assert!(codegen.contains("services/**"), "{codegen}");
    } else {
        let id = output
            .split("steps.")
            .nth(1)
            .and_then(|rest| rest.split('.').next())
            .expect("step id");
        let step = steps
            .iter()
            .find(|step| step["id"].as_str() == Some(id))
            .expect("step");
        assert!(
            step["run"]
                .as_str()
                .unwrap_or_default()
                .contains("merge_group"),
            "{id} must not narrow Generated Code Check in the merge queue"
        );
    }
}
