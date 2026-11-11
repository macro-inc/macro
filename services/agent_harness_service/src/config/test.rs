use super::*;
use std::sync::Arc;

struct TestSecretManager;

impl secretsmanager_client::SecretManager for TestSecretManager {
    type Err = std::io::Error;

    async fn get_secret_value<T: AsRef<str> + Send>(
        &self,
        secret_name: T,
    ) -> Result<Arc<str>, Self::Err> {
        if secret_name.as_ref() == "auth-secret-name" {
            Ok(Arc::from("resolved-auth-key"))
        } else {
            Ok(Arc::from(secret_name.as_ref()))
        }
    }
}

fn config_values() -> serde_json::Value {
    serde_json::json!({
        "ENVIRONMENT": "dev",
        "FUSIONAUTH_BASE_URL": "https://example.com",
        "FUSIONAUTH_CLIENT_ID": "client-id",
        "FUSIONAUTH_API_KEY_SECRET_KEY": "fusionauth-api-key",
        "FUSIONAUTH_CLIENT_SECRET_KEY": "fusionauth-client-secret",
        "GOOGLE_CLIENT_ID": "google-client-id",
        "GOOGLE_CLIENT_SECRET_KEY": "google-client-secret",
        "OPENAI_DOMAIN_VERIFICATION_TOKEN": "test-token",
        "AUTHENTICATION_SERVICE_SECRET_KEY": "auth-secret-name",
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS": 500,
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS": 2000,
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS": 10000,
        "AI_USAGE_OVERAGE_MARKUP_PERCENT": 5,
        "COMPUTER_RETENTION_DAYS": 14,
        "COMPUTER_PAST_DUE_GRACE_DAYS": 7,
        "KAFKA_BROKERS": "localhost:9092",
        "DATABASE_URL": "postgres://user:password@localhost:5432/macrodb",
        "REDIS_URI": "redis://localhost:6379",
        "MCP_OAUTH_KMS_KEY_ID": "test-kms-id",
        "HARNESS_BOT_ID": "00000000-0000-0000-0000-000000000001",
        "INTERNAL_API_KEY": "test-key",
        "DOCUMENT_STORAGE_SERVICE_AUTH_KEY": "test-key",
        "PIPEDREAM_CLIENT_ID": "pipedream-client-id",
        "PIPEDREAM_CLIENT_SECRET": "pipedream-client-secret",
        "PIPEDREAM_PROJECT_ID": "pipedream-project-id",
        "MACRO_API_TOKEN_PRIVATE_SECRET_KEY": "signing-secret-name",
        "MCP_CREDENTIALS_KEY_SECRET_NAME": "mcp-secret-name",
        "MACRO_API_TOKEN_ISSUER": "test-issuer",
        "AGENT_SESSION_CHANGES_BUCKET": "test-bucket",
        "GITHUB_PULL_REQUEST_PATCH_BUCKET": "test-bucket",
        "GITHUB_SYNC_APP_CLIENT_ID": "github-client-id",
        "GITHUB_SYNC_APP_PEM_SECRET_KEY": "github-secret-name"
    })
}

#[test]
fn authentication_key_is_required_with_billing_disabled_or_enabled() {
    for billing in [false, true] {
        let mut values = config_values();
        values["ENABLE_AI_USAGE_BILLING"] = serde_json::json!(billing);
        values
            .as_object_mut()
            .unwrap()
            .remove("AUTHENTICATION_SERVICE_SECRET_KEY");
        let error = serde_json::from_value::<Config>(values).err().unwrap();
        assert!(
            error
                .to_string()
                .contains("AUTHENTICATION_SERVICE_SECRET_KEY")
        );

        let mut values = config_values();
        values["ENABLE_AI_USAGE_BILLING"] = serde_json::json!(billing);
        values["AUTHENTICATION_SERVICE_SECRET_KEY"] = serde_json::Value::Null;
        assert!(serde_json::from_value::<Config>(values).is_err());
    }
}

#[tokio::test]
async fn authentication_key_resolves_before_linked_github_client_is_built() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    let config = config
        .resolve_remote_secrets(Environment::Develop, &TestSecretManager)
        .await
        .unwrap();
    assert_eq!(
        config.authentication_service_secret_key.as_ref(),
        "resolved-auth-key"
    );
    config.linked_github_tokens().unwrap();
}

fn values() -> serde_json::Value {
    let mut values = serde_json::json!({
        "ENVIRONMENT": "local",
        "HARNESS_BOT_ID": "00000000-0000-0000-0000-000000000001",
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS": 500,
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS": 1500,
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS": 15000,
        "AI_USAGE_OVERAGE_MARKUP_PERCENT": 25,
        "COMPUTER_RETENTION_DAYS": 14,
        "COMPUTER_PAST_DUE_GRACE_DAYS": 7
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
        "AUTHENTICATION_SERVICE_SECRET_KEY",
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

#[test]
fn computer_retention_and_past_due_grace_are_mandatory() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert_eq!(
        config.computer_billing_policy().unwrap(),
        hosted_runtimes::domain::lifecycle::BillingPolicy::from_days(14, 7).unwrap()
    );
    for key in ["COMPUTER_RETENTION_DAYS", "COMPUTER_PAST_DUE_GRACE_DAYS"] {
        let mut missing = config_values();
        missing.as_object_mut().unwrap().remove(key);
        assert!(serde_json::from_value::<Config>(missing).is_err(), "{key}");
        let mut zero = config_values();
        zero[key] = serde_json::json!(0);
        let config: Config = serde_json::from_value(zero).unwrap();
        assert!(config.computer_billing_policy().is_err(), "{key}");
    }
}
