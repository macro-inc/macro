use super::{ComputerFleetKind, Config, DockerFleetSettings};

fn values() -> serde_json::Value {
    let mut values = serde_json::json!({
        "ENVIRONMENT": "local",
        "COMPUTERS_FLEET": "disabled",
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

#[test]
fn absent_credentials_are_an_explicit_calls_off_option() {
    let config: Config = serde_json::from_value(values()).unwrap();
    assert!(config.livekit_credentials().unwrap().is_none());
}

#[test]
fn configured_calls_require_both_valid_credentials() {
    let mut values = values();
    values["LIVEKIT_API_KEY"] = serde_json::json!("project-key");
    values["LIVEKIT_API_SECRET"] = serde_json::json!("project-secret");
    let config: Config = serde_json::from_value(values).unwrap();
    let credentials = config
        .livekit_credentials()
        .unwrap()
        .expect("calls enabled");
    assert_eq!(credentials.api_key(), "project-key");
    assert_eq!(credentials.api_secret(), "project-secret");
}

#[test]
fn partial_blank_and_padded_credentials_fail_without_exposing_values() {
    for (key, secret) in [
        (Some("project-key"), None),
        (None, Some("project-secret")),
        (Some(""), Some("")),
        (Some("project-key"), Some("")),
        (Some(""), Some("project-secret")),
        (Some("  "), Some("project-secret")),
        (Some("project-key"), Some("\t")),
        (Some(" project-key"), Some("project-secret")),
        (Some("project-key"), Some("project-secret ")),
    ] {
        let mut values = values();
        if let Some(key) = key {
            values["LIVEKIT_API_KEY"] = serde_json::json!(key);
        }
        if let Some(secret) = secret {
            values["LIVEKIT_API_SECRET"] = serde_json::json!(secret);
        }
        let config: Config = serde_json::from_value(values).unwrap();
        let error = config
            .livekit_credentials()
            .err()
            .expect("invalid credentials")
            .to_string();
        assert!(error.contains("LIVEKIT_API_KEY"));
        assert!(error.contains("LIVEKIT_API_SECRET"));
        assert!(!error.contains("project-key"));
        assert!(!error.contains("project-secret"));
    }
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct Selection {
    computers_fleet: ComputerFleetKind,
}

#[test]
fn computer_fleet_selection_is_required() {
    let error = serde_json::from_str::<Selection>("{}").err().unwrap();
    assert!(error.to_string().contains("COMPUTERS_FLEET"));
    let selection: Selection = serde_json::from_str(r#"{"COMPUTERS_FLEET":"disabled"}"#).unwrap();
    assert!(matches!(
        selection.computers_fleet,
        ComputerFleetKind::Disabled
    ));
    assert!(serde_json::from_str::<Selection>(r#"{"COMPUTERS_FLEET":"off"}"#).is_err());
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
