use super::*;

fn yaml() -> String {
    crate::workflows::render_patched(deploy_observability, patch).expect("workflow yaml")
}

fn workflow() -> serde_yaml::Value {
    serde_yaml::from_str(&yaml()).expect("parse")
}

fn step_names(job: &str) -> Vec<String> {
    workflow()["jobs"][job]["steps"]
        .as_sequence()
        .expect("steps")
        .iter()
        .map(|step| step["name"].as_str().unwrap_or_default().to_owned())
        .collect()
}

fn position(names: &[String], name: &str) -> usize {
    names
        .iter()
        .position(|candidate| candidate == name)
        .unwrap_or_else(|| panic!("no step `{name}` in {names:?}"))
}

#[test]
fn deploys_only_when_started_by_hand_and_defaults_to_a_dry_run() {
    let root = workflow();
    let on = root["on"].as_mapping().expect("on");
    assert!(
        !on.contains_key("push"),
        "every rollout causes downtime, so none starts on push"
    );
    let input = &root["on"]["workflow_dispatch"]["inputs"]["dry_run"];
    assert_eq!(input["type"].as_str(), Some("boolean"));
    assert_eq!(input["default"].as_bool(), Some(true));
    assert!(
        input["description"]
            .as_str()
            .is_some_and(|text| text.contains("down")),
        "the input says the rollout causes downtime"
    );
    assert_eq!(
        root["jobs"]["deploy"]["if"].as_str(),
        Some("github.event_name == 'workflow_dispatch'")
    );
    assert_eq!(
        root["jobs"]["build-image"]["if"].as_str(),
        Some("github.event_name == 'pull_request'")
    );
}

#[test]
fn rollouts_never_overlap_or_cancel() {
    let root = workflow();
    let concurrency = &root["jobs"]["deploy"]["concurrency"];
    assert_eq!(
        concurrency["group"].as_str(),
        Some("deploy-observability-prod")
    );
    assert_eq!(concurrency["cancel-in-progress"].as_bool(), Some(false));
}

#[test]
fn only_the_deploy_job_gets_the_stored_aws_credentials() {
    let root = workflow();
    // The stored deploy keys, like the other deploy workflows; no OIDC role.
    assert_eq!(root["permissions"]["id-token"].as_str(), None);
    assert!(root["jobs"]["deploy"]["permissions"].is_null());
    let text = yaml();
    let (build_job, deploy_job) = text.split_once("  deploy:").expect("deploy job");
    for secret in [
        "AWS_ACCESS_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "PULUMI_ACCESS_TOKEN",
    ] {
        assert!(
            !build_job.contains(secret),
            "the PR build job must not see {secret}"
        );
        assert!(deploy_job.contains(secret), "the deploy job needs {secret}");
    }
    assert!(!text.contains("role-to-assume"));
}

#[test]
fn production_is_touched_only_after_the_smoke_boot() {
    let names = step_names("deploy");
    let order = [
        "Refuse branches other than main",
        "Refuse a commit older than main's last stack change",
        "Find this source's image",
        "Build the NixOS image",
        "Publish the AMI",
        "Smoke-boot the AMI on a throwaway host",
        "Check the plan and roll out",
        "Remove smoke resources a cancelled run left",
    ];
    let positions: Vec<usize> = order.iter().map(|name| position(&names, name)).collect();
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "steps out of order: {names:?}"
    );
    let text = yaml();
    for needle in [
        "DRY_RUN: ${{ inputs.dry_run }}",
        "bun deploy/release.ts deploy",
        "aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY }}",
        "steps.find.outputs.stage == 'build'",
    ] {
        assert!(text.contains(needle), "missing `{needle}`:\n{text}");
    }
    // The workflow never runs `pulumi up` itself; release.ts gates it.
    assert!(!text.contains("command: up"));
}
