use super::*;

#[test]
fn bootstrap_defers_preview_until_activation_without_hiding_paused_services() {
    let mut config = serde_json::json!({"services": {
        "ready": {},
        "pending": {"bootstrap_pending": "Requires first-time setup"},
        "paused": {"deploy_enabled": false}
    }});
    let changed = [".github/services-config.json"];
    assert_eq!(
        detect(&changed, &config),
        serde_json::json!(["paused", "ready"])
    );
    config["services"]["pending"]
        .as_object_mut()
        .unwrap()
        .remove("bootstrap_pending");
    assert_eq!(
        detect(&changed, &config),
        serde_json::json!(["paused", "pending", "ready"])
    );
}

/// Run the detect script against `changed` and return the services it picks.
fn detect(changed: &[&str], config: &serde_json::Value) -> serde_json::Value {
    let dir = tempfile::tempdir().unwrap();
    let github = dir.path().join(".github");
    std::fs::create_dir_all(github.join("outputs")).unwrap();
    std::fs::write(
        github.join("outputs/all_modified_files.json"),
        serde_json::to_string(changed).unwrap(),
    )
    .unwrap();
    std::fs::write(github.join("services-config.json"), config.to_string()).unwrap();
    let output_path = dir.path().join("output");
    std::fs::write(&output_path, "").unwrap();
    let output = std::process::Command::new("bash")
        .args([
            "-euo",
            "pipefail",
            "-c",
            &detect_affected_services().value.run.unwrap(),
        ])
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
    let services = result
        .lines()
        .find_map(|line| line.strip_prefix("services="))
        .unwrap_or_else(|| panic!("no services output: {result}"));
    serde_json::from_str(services).unwrap()
}

#[test]
fn previews_only_stacks_whose_infra_changed() {
    let config = serde_json::json!({"services": {
        "email-service": {
            "source_paths": ["services/email_service/**", "crates/email/**"],
            "stack_path": "infra/stacks/email-service/**",
            "deploy_binaries": ["email_service"]
        },
        "kafka-cluster": {
            "source_paths": ["crates/macro_event_topics/**"],
            "stack_path": "infra/stacks/kafka-cluster/**"
        }
    }});
    let all = serde_json::json!(["email-service", "kafka-cluster"]);
    let none = serde_json::json!([]);
    let cases: &[(&[&str], serde_json::Value)] = &[
        // Code, lockfile, and query-cache changes never reach a stack definition.
        (&["Cargo.lock"], none.clone()),
        (&["Cargo.toml", ".sqlx/query-abc.json"], none.clone()),
        (&["services/email_service/src/main.rs"], none.clone()),
        (&["crates/email/src/lib.rs", "flake.lock"], none.clone()),
        (&["crates/macro_event_topics/src/lib.rs"], none.clone()),
        (&[".github/workspace-dep-closures.json"], none.clone()),
        (
            &["infra/stacks/email-service/index.ts"],
            serde_json::json!(["email-service"]),
        ),
        (
            &["infra/stacks/kafka-cluster/topics.ts", "Cargo.lock"],
            serde_json::json!(["kafka-cluster"]),
        ),
        (
            &[".github/kafka-cluster-topics.json"],
            serde_json::json!(["kafka-cluster"]),
        ),
        // Unmapped stacks warn instead of previewing.
        (&["infra/stacks/github-runners/runner.ts"], none.clone()),
        (&["infra/local/compose.yml"], none.clone()),
        // Shared infra code and root manifests affect every stack.
        (&["infra/packages/resources/src/index.ts"], all.clone()),
        (&["infra/bun.lock"], all.clone()),
        (
            &[".github/workflows/reusable_preview_service.yml"],
            all.clone(),
        ),
        (
            &[".github/scripts/build-cloud-storage-lambdas-nix.sh"],
            all.clone(),
        ),
    ];
    for (changed, expected) in cases {
        assert_eq!(&detect(changed, &config), expected, "changed: {changed:?}");
    }
}

#[test]
fn changed_files_action_emits_json_list() {
    let with = serde_json::to_string(&changed_files().value.with).expect("with serializes");
    assert!(
        with.contains(r#""json":"true""#) && with.contains(r#""escape_json":"false""#),
        "{with}"
    );
}
