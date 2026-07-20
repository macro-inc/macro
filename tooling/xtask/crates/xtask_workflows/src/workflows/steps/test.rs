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
