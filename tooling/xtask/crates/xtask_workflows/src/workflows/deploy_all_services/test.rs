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

fn deployment_partitions(
    config: serde_json::Value,
) -> (bool, std::collections::BTreeMap<String, Vec<String>>) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".github")).unwrap();
    std::fs::write(
        dir.path().join(".github/services-config.json"),
        config.to_string(),
    )
    .unwrap();
    let path = dir.path().join("output");
    std::fs::write(&path, "").unwrap();
    let output = std::process::Command::new("bash")
        .args(["-euo", "pipefail", "-c", &set_matrix().value.run.unwrap()])
        .current_dir(dir.path())
        .env("GITHUB_OUTPUT", &path)
        .output()
        .unwrap();
    let values = std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            Some((key.to_string(), serde_json::from_str(value).unwrap()))
        })
        .collect();
    (output.status.success(), values)
}

#[test]
fn consumer_and_api_partition_is_ordered_without_serializing_other_services() {
    let (ok, matrices) = deployment_partitions(serde_json::json!({"services": {
        "email-service": {"deploy_binaries": ["pubsub_workers"]},
        "document-storage-service": {"deploy_binaries": ["document_storage_service"]},
        "unrelated": {}, "paused": {"deploy_enabled": false},
        "pending": {"bootstrap_pending": "setup"}
    }}));
    assert!(ok);
    assert_eq!(matrices["email"], ["email-service"]);
    assert_eq!(matrices["dss"], ["document-storage-service"]);
    assert_eq!(matrices["others"], ["unrelated"]);
    let mut partitioned = ["email", "dss", "others"]
        .into_iter()
        .flat_map(|key| matrices[key].clone())
        .collect::<Vec<_>>();
    partitioned.sort();
    let mut all = matrices["matrix"].clone();
    all.sort();
    assert_eq!(partitioned, all);
    let dss = serde_json::to_value(deploy_services("dss", true)).unwrap();
    assert!(
        dss["needs"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("deploy-email"))
    );
    let condition = dss["if"].as_str().unwrap();
    for clause in [
        "needs.deploy-email.result == 'success'",
        "needs.migrate-db.result == 'success'",
        "!cancelled()",
        "'cancelled'",
        "'failure'",
    ] {
        assert!(condition.contains(clause), "{condition}");
    }
    let others = serde_json::to_value(deploy_services("others", false)).unwrap();
    assert!(
        !others["needs"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("deploy-email"))
    );
}

#[test]
fn absent_disabled_or_unbootstrapped_email_cannot_admit_dss() {
    for email in [
        None,
        Some(serde_json::json!({"deploy_enabled": false})),
        Some(serde_json::json!({"bootstrap_pending": "setup"})),
    ] {
        let mut config = serde_json::json!({"services": {"document-storage-service": {}}});
        if let Some(email) = email {
            config["services"]["email-service"] = email;
        }
        assert!(!deployment_partitions(config).0);
    }
    let (ok, matrices) = deployment_partitions(serde_json::json!({"services": {}}));
    assert!(ok);
    assert!(matrices.values().all(Vec::is_empty));
}

#[test]
fn rollout_and_summary_scripts_cover_failed_cancelled_and_noop_deployments() {
    let result = std::process::Command::new("bun")
        .args(["test", "./.github/scripts/crm-deployment.test.ts"])
        .current_dir(xtask_paths::repo_root())
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
