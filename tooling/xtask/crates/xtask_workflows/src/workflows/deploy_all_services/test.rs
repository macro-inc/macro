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
