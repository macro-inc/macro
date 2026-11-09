use super::{Config, DockerFleetSettings};

fn values() -> serde_json::Value {
    let mut values = serde_json::json!({
        "ENVIRONMENT": "local",
        "HARNESS_BOT_ID": "00000000-0000-0000-0000-000000000001",
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS": 500,
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS": 1500,
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS": 15000,
        "AI_USAGE_OVERAGE_MARKUP_PERCENT": 25
    });
    for key in [
        "FUSIONAUTH_BASE_URL",
        "FUSIONAUTH_CLIENT_ID",
        "FUSIONAUTH_API_KEY_SECRET_KEY",
        "FUSIONAUTH_CLIENT_SECRET_KEY",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET_KEY",
        "OPENAI_DOMAIN_VERIFICATION_TOKEN",
        "KAFKA_BROKERS",
        "DATABASE_URL",
        "REDIS_URI",
        "MCP_OAUTH_KMS_KEY_ID",
        "INTERNAL_API_KEY",
        "DOCUMENT_STORAGE_SERVICE_AUTH_KEY",
        "PIPEDREAM_CLIENT_ID",
        "PIPEDREAM_CLIENT_SECRET",
        "PIPEDREAM_PROJECT_ID",
        "MACRO_API_TOKEN_PRIVATE_SECRET_KEY",
        "MCP_CREDENTIALS_KEY_SECRET_NAME",
        "MACRO_API_TOKEN_ISSUER",
        "AGENT_SESSION_CHANGES_BUCKET",
        "GITHUB_PULL_REQUEST_PATCH_BUCKET",
        "GITHUB_SYNC_APP_CLIENT_ID",
        "GITHUB_SYNC_APP_PEM_SECRET_KEY",
    ] {
        values[key] = serde_json::json!("local");
    }
    values
}

// Run the real environment loader in a child process so these complete, dummy
// deployment configurations cannot race any other test's environment.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct FleetProbe {
    fleet_probe: Option<bool>,
}

#[test]
fn fleet_loader_process() {
    let probe: FleetProbe = macro_config::load().unwrap();
    if probe.fleet_probe != Some(true) {
        return;
    }
    let config = Config::from_env().unwrap();
    config.validate_fleet_selection().unwrap();
    // This is startup's selected-group loader. The Doppler binary shares the
    // same Config, selection validator and selected settings validators.
    config.computer_fleet().unwrap();
}

#[test]
fn production_loader_accepts_no_fleet_and_rejects_invalid_or_incomplete_selection() {
    let mut production = values();
    production["ENVIRONMENT"] = serde_json::json!("prod");
    production["FLEET_PROBE"] = serde_json::json!(true);
    assert!(
        !production
            .as_object()
            .unwrap()
            .keys()
            .any(|key| key.starts_with("COMPUTERS_"))
    );
    for (selector, succeeds) in [
        (None, true),
        (Some("disabled"), false),
        (Some(""), false),
        (Some("off"), false),
        (Some("unknown"), false),
        (Some("incus"), false),
        (Some("docker"), false),
    ] {
        let mut input = production.clone();
        if let Some(selector) = selector {
            input["COMPUTERS_FLEET"] = serde_json::json!(selector);
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "config::test::fleet_loader_process",
                "--nocapture",
            ])
            .env_clear()
            // Preserve only the dynamic loader's search paths, never inherited
            // application configuration or credentials from the parent test.
            .envs(
                [
                    "LD_LIBRARY_PATH",
                    "NIX_LD",
                    "NIX_LD_LIBRARY_PATH",
                    "DYLD_LIBRARY_PATH",
                    "DYLD_FALLBACK_LIBRARY_PATH",
                ]
                .into_iter()
                .filter_map(|key| std::env::var_os(key).map(|value| (key, value))),
            )
            .env("ENVIRONMENT", "prod")
            .env("APP_SECRETS_JSON", input.to_string())
            .output()
            .unwrap();
        assert_eq!(
            output.status.success(),
            succeeds,
            "selector {selector:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn computer_fleet_settings_require_the_selected_groups() {
    let error = serde_json::from_str::<DockerFleetSettings>("{}")
        .err()
        .unwrap();
    assert!(error.to_string().contains("COMPUTERS_CONTROL_PLANE_ID"));
    let settings = serde_json::json!({
        "COMPUTERS_CONTROL_PLANE_ID": "local-test",
        "COMPUTERS_HOST_NAME": "local-docker",
        "COMPUTERS_IMAGE": "macro-box:latest",
        "COMPUTERS_HOST_RESERVE_GB": 7,
        "COMPUTERS_OVERSELL_FACTOR": 3,
        "COMPUTERS_DOCKER_NETWORK": "test-services",
        "COMPUTERS_DOCKER_ENROLLMENT_DIR": "/tmp/enrollments",
        "COMPUTERS_DOCKER_MEMORY_GB": 32
    });
    let config: DockerFleetSettings = serde_json::from_value(settings.clone()).unwrap();
    config.validate().unwrap();
    let mut missing = settings.clone();
    missing
        .as_object_mut()
        .unwrap()
        .remove("COMPUTERS_DOCKER_MEMORY_GB");
    let error = serde_json::from_value::<DockerFleetSettings>(missing)
        .err()
        .unwrap();
    assert!(error.to_string().contains("COMPUTERS_DOCKER_MEMORY_GB"));
    let mut blank = settings;
    blank["COMPUTERS_IMAGE"] = serde_json::json!("");
    assert!(
        serde_json::from_value::<DockerFleetSettings>(blank)
            .unwrap()
            .validate()
            .unwrap_err()
            .to_string()
            .contains("COMPUTERS_IMAGE")
    );
}
