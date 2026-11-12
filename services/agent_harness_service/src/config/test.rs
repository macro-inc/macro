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

#[test]
fn the_idle_timeout_defaults_to_fifteen_minutes_and_refuses_less_than_thirty_seconds() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert_eq!(
        config.agent_session_idle_timeout().unwrap(),
        std::time::Duration::from_secs(900)
    );

    let mut values = config_values();
    values["AGENT_SESSION_IDLE_TIMEOUT_SECS"] = serde_json::json!(30);
    let config: Config = serde_json::from_value(values).unwrap();
    assert_eq!(
        config.agent_session_idle_timeout().unwrap(),
        std::time::Duration::from_secs(30)
    );

    for too_short in [0, 29] {
        let mut values = config_values();
        values["AGENT_SESSION_IDLE_TIMEOUT_SECS"] = serde_json::json!(too_short);
        let config: Config = serde_json::from_value(values).unwrap();
        let error = config.agent_session_idle_timeout().unwrap_err();
        assert!(
            error
                .to_string()
                .contains("AGENT_SESSION_IDLE_TIMEOUT_SECS"),
            "the error names the setting: {error}"
        );
    }
}
