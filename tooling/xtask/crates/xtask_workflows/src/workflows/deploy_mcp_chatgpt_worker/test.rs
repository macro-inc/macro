use super::*;

fn rendered(build: fn() -> Workflow) -> serde_yaml::Value {
    serde_yaml::from_str(&crate::workflows::render_gh_workflow(build)().expect("workflow yaml"))
        .expect("parse workflow")
}

const WORKFLOW: &str = "./.github/workflows/deploy_mcp_chatgpt_worker.yml";

/// Dev deploys on every push and prod on every release, through the same
/// callers and with the same contract as the sync service.
#[test]
fn both_pipelines_deploy_the_worker_like_the_sync_service() {
    let dev = rendered(crate::workflows::deploy_on_push::deploy_on_push);
    let prod = rendered(crate::workflows::release_production::release_production);
    for (environment, workflow) in [("dev", dev), ("prod", prod)] {
        let jobs = &workflow["jobs"];
        let worker = &jobs["deploy-mcp-chatgpt-worker"];
        let sync = &jobs["deploy-sync-service"];
        assert_eq!(worker["uses"].as_str(), Some(WORKFLOW), "{environment}");
        assert_eq!(
            worker["with"]["environment"].as_str(),
            Some(environment),
            "{environment}"
        );
        assert_eq!(worker["needs"], sync["needs"], "{environment}");
        assert_eq!(worker["secrets"], sync["secrets"], "{environment}");
        assert!(worker["if"].is_null(), "{environment} must not path-gate");
        for (id, job) in jobs.as_mapping().expect("jobs") {
            let needs = job["needs"].as_sequence().cloned().unwrap_or_default();
            assert!(
                !needs.contains(&serde_yaml::Value::from("deploy-mcp-chatgpt-worker")),
                "{environment}: {id:?} must not wait on the ChatGPT worker"
            );
        }
    }
}

#[test]
fn the_call_contract_matches_the_sync_service() {
    let worker = rendered(deploy_mcp_chatgpt_worker);
    let sync = rendered(crate::workflows::deploy_sync_service::deploy_sync_service);
    assert_eq!(worker["on"]["workflow_call"], sync["on"]["workflow_call"]);
    assert_eq!(
        worker["on"]["workflow_dispatch"],
        sync["on"]["workflow_dispatch"]
    );
    assert!(worker["on"]["push"].is_null());
}

/// A worker deployed without a secret it needs fails every request; a failed
/// check leaves the live version serving.
#[test]
fn secrets_are_checked_before_deploying() {
    let worker = rendered(deploy_mcp_chatgpt_worker);
    let steps = worker["jobs"]["deploy"]["steps"]
        .as_sequence()
        .expect("steps");
    let position = |prefix: &str| {
        steps
            .iter()
            .position(|step| {
                step["run"]
                    .as_str()
                    .is_some_and(|command| command.starts_with(prefix))
            })
            .unwrap_or_else(|| panic!("no step runs {prefix}"))
    };
    let check = position("node scripts/check-deploy-secrets.mjs ");
    let deploy = position("bunx wrangler deploy --env ");
    assert!(check < deploy);
    assert!(steps[check]["continue-on-error"].is_null());
    assert!(steps[check]["if"].is_null());
}
