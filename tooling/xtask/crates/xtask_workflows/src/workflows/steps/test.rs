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
#[test]
fn search_consumers_cannot_deploy_before_schema_provisioning() {
    let all: serde_yaml::Value = serde_yaml::from_str(
        &crate::workflows::deploy_all_services::deploy_all_services()
            .to_string()
            .unwrap(),
    )
    .unwrap();
    let migration = &all["jobs"]["migrate-db"];
    assert_eq!(migration["runs-on"], "db-migrator");
    let schema = migration["steps"]
        .as_sequence()
        .unwrap()
        .iter()
        .find(|step| step["uses"].as_str() == Some("./.github/actions/provision-search-indices"))
        .expect("release deployment must provision search indices on the VPC runner");
    assert_eq!(schema["with"]["index"], "agent_sessions");
    assert!(
        schema["if"]
            .as_str()
            .unwrap()
            .contains("search-processing-service")
    );
    let deploy = &all["jobs"]["deploy-services"];
    assert!(
        deploy["needs"]
            .as_sequence()
            .unwrap()
            .iter()
            .any(|need| need == "migrate-db")
    );
    assert!(
        deploy["if"]
            .as_str()
            .unwrap()
            .contains("needs.migrate-db.result == 'success'")
    );

    let single: serde_yaml::Value = serde_yaml::from_str(
        &crate::workflows::reusable_deploy_service::reusable_deploy_service()
            .to_string()
            .unwrap(),
    )
    .unwrap();
    let schema = &single["jobs"]["provision-search"];
    assert_eq!(schema["runs-on"], "db-migrator");
    assert!(
        schema["if"]
            .as_str()
            .unwrap()
            .contains("inputs.service-name == 'search-processing-service'")
    );
    let deploy = &single["jobs"]["deploy"];
    assert!(
        deploy["needs"]
            .as_sequence()
            .unwrap()
            .iter()
            .any(|need| need == "provision-search")
    );
    assert!(deploy["if"].as_str().unwrap().contains("!failure()"));
}
