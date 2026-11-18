use super::*;

fn deploy_steps() -> Vec<serde_yaml::Value> {
    let rendered: serde_yaml::Value = serde_yaml::from_str(
        &crate::workflows::render_patched(deploy_web_app, patch).expect("workflow yaml"),
    )
    .expect("parse workflow");
    rendered["jobs"]["deploy"]["steps"]
        .as_sequence()
        .expect("deploy steps")
        .clone()
}

/// The publish step re-checks the bundle against the live one: a deploy-only
/// re-run never repeats the build job's check.
#[test]
fn deploy_checks_the_live_bundle_right_before_publishing() {
    let steps = deploy_steps();
    let guard = steps
        .iter()
        .position(|step| step["name"].as_str() == Some("Check bundle against live"))
        .expect("guard step");
    let pulumi = steps
        .iter()
        .position(|step| step["name"].as_str() == Some("Deploy with Pulumi"))
        .expect("pulumi step");
    assert_eq!(guard + 1, pulumi);
    assert_eq!(
        steps[guard]["env"]["ROLLBACK"].as_str(),
        Some("${{ inputs.rollback }}")
    );
    assert_eq!(
        steps[guard]["env"]["ENVIRONMENT"].as_str(),
        Some("${{ inputs.environment }}")
    );
    let script = steps[guard]["run"].as_str().expect("guard script");
    assert!(
        script.contains("apps/web/dist/bundle-manifest.json"),
        "{script}"
    );
    assert!(!script.contains("cargo"), "the deploy job compiles nothing");
}
