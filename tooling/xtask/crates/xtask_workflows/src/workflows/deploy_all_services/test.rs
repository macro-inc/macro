use super::*;

#[test]
fn bootstrap_excludes_all_deployment_matrices_until_activation() {
    let dir = tempfile::tempdir().unwrap();
    let github = dir.path().join(".github");
    std::fs::create_dir(&github).unwrap();
    let mut config = serde_json::json!({"services": {
        "ready": {"deploy_binaries": ["ready"], "deploy_lambdas": ["ready_lambda"]},
        "pending": {"bootstrap_pending": "Requires first-time setup", "deploy_binaries": ["pending"], "deploy_lambdas": ["pending_lambda"]},
        "paused": {"deploy_enabled": false, "deploy_binaries": ["paused"]}
    }});
    for expected in [
        serde_json::json!(["ready"]),
        serde_json::json!(["pending", "ready"]),
    ] {
        std::fs::write(github.join("services-config.json"), config.to_string()).unwrap();
        let output_path = dir.path().join("output");
        std::fs::write(&output_path, "").unwrap();
        let output = std::process::Command::new("bash")
            .args(["-euo", "pipefail", "-c", &set_matrix().value.run.unwrap()])
            .current_dir(dir.path())
            .env("GITHUB_OUTPUT", &output_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result = std::fs::read_to_string(output_path).unwrap();
        for matrix in ["matrix", "binaries", "lambdas"] {
            let prefix = format!("{matrix}=");
            let value = result
                .lines()
                .find_map(|line| line.strip_prefix(&prefix))
                .unwrap();
            let mut actual: Vec<String> = serde_json::from_str(value).unwrap();
            actual.sort();
            assert_eq!(serde_json::json!(actual), expected, "{result}");
        }
        config["services"]["pending"]
            .as_object_mut()
            .unwrap()
            .remove("bootstrap_pending");
    }
}

#[test]
fn email_and_document_storage_deploy_in_the_shared_matrix() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".github")).unwrap();
    std::fs::write(
        dir.path().join(".github/services-config.json"),
        serde_json::json!({"services": {
            "email-service": {"deploy_enabled": false},
            "document-storage-service": {},
            "unrelated": {}
        }})
        .to_string(),
    )
    .unwrap();
    let output_path = dir.path().join("output");
    std::fs::write(&output_path, "").unwrap();
    let output = std::process::Command::new("bash")
        .args(["-euo", "pipefail", "-c", &set_matrix().value.run.unwrap()])
        .current_dir(dir.path())
        .env("GITHUB_OUTPUT", &output_path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result = std::fs::read_to_string(output_path).unwrap();
    assert!(
        result
            .lines()
            .any(|line| line == r#"matrix=["document-storage-service","unrelated"]"#),
        "{result}"
    );

    let workflow = serde_json::to_value(deploy_all_services()).unwrap();
    let jobs = workflow["jobs"].as_object().unwrap();
    let deploy_jobs: Vec<&String> = jobs
        .keys()
        .filter(|job| job.starts_with("deploy-"))
        .collect();
    assert_eq!(deploy_jobs, ["deploy-services"]);
    assert_eq!(
        jobs["deploy-services"]["strategy"]["matrix"]["service"],
        "${{ fromJson(needs.setup.outputs.matrix) }}"
    );
}

#[test]
fn summary_script_covers_failed_cancelled_and_noop_deployments() {
    let result = std::process::Command::new("bun")
        .args([
            "test",
            "./.github/scripts/check-service-deployment-results.test.ts",
        ])
        .current_dir(xtask_paths::repo_root())
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn summary_uses_the_verified_immutable_bun_action() {
    let summary = serde_json::to_value(deployment_summary()).unwrap();
    let bun = summary["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["name"] == "Setup Bun")
        .unwrap();
    assert_eq!(
        bun["uses"],
        "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6"
    );
}
