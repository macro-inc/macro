use super::*;

#[test]
fn web_publication_waits_for_sync_protocol_support() -> Result<()> {
    let dev = crate::workflows::render_patched(deploy_on_push, patch)?;
    let prod = std::fs::read_to_string(
        xtask_paths::repo_root().join(".github/workflows/release-production.yml"),
    )?;

    for (environment, yaml, web_job, build_job) in [
        ("dev", dev, "deploy-web-app", "build-web-app"),
        ("prod", prod, "deploy", "build"),
    ] {
        let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml)?;
        let jobs = &workflow["jobs"];
        let needs = jobs[web_job]["needs"].as_sequence().expect("dependencies");
        assert!(
            needs.contains(&serde_yaml::Value::from("deploy-sync-service")),
            "{environment} must deploy sync-service before publishing the web app"
        );
        assert!(needs.contains(&serde_yaml::Value::from(build_job)));
        assert!(
            jobs[web_job]["if"].is_null(),
            "failed sync deployment must prevent web publication"
        );
        assert!(
            jobs[build_job]["needs"].is_null(),
            "the web build should still run in parallel with deployment"
        );
    }
    Ok(())
}

#[test]
fn sync_deployment_waits_for_active_objects_before_unblocking_clients() -> Result<()> {
    let yaml = crate::workflows::render_patched(
        crate::workflows::deploy_sync_service::deploy_sync_service,
        crate::workflows::deploy_sync_service::patch,
    )?;
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml)?;
    let steps = workflow["jobs"]["deploy"]["steps"]
        .as_sequence()
        .expect("deployment steps");
    let deploy = steps
        .iter()
        .position(|step| {
            step["run"]
                .as_str()
                .is_some_and(|command| command.starts_with("npx wrangler deploy --env "))
        })
        .expect("worker deployment");
    let wait = steps
        .iter()
        .position(|step| step["run"].as_str() == Some("sleep 300"))
        .expect("the worker job must wait out the default code-update deferral");
    assert!(deploy < wait);
    assert!(steps[wait]["if"].is_null());
    assert!(steps[wait]["continue-on-error"].is_null());
    Ok(())
}
