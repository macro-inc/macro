use super::*;
use serde_json::{Value, json};

fn deployed_config_values() -> Value {
    json!({
        "ENVIRONMENT": "dev",
        "FUSIONAUTH_BASE_URL": "http://fusionauth:9011",
        "FUSIONAUTH_CLIENT_ID": "fusionauth-client",
        "FUSIONAUTH_API_KEY_SECRET_KEY": "fusionauth-api-key-dev",
        "FUSIONAUTH_CLIENT_SECRET_KEY": "fusionauth-client-secret-dev",
        "GOOGLE_CLIENT_ID": "google-client",
        "GOOGLE_CLIENT_SECRET_KEY": "google-client-secret-dev",
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS": 500,
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS": 2000,
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS": 10000,
        "AI_USAGE_OVERAGE_MARKUP_PERCENT": 5,
        "KAFKA_BROKERS": "broker:9092",
        "DATABASE_URL": "postgres://localhost/macrodb",
        "REDIS_URI": "redis://localhost:6379",
        "HARNESS_BOT_ID": "00000000-0000-0000-0000-00000000a9e7",
        "INTERNAL_API_KEY": "internal-api-key",
        "DOCUMENT_STORAGE_SERVICE_AUTH_KEY": "document-storage-key",
        "PIPEDREAM_CLIENT_ID": "pipedream-client",
        "PIPEDREAM_CLIENT_SECRET": "pipedream-secret",
        "PIPEDREAM_PROJECT_ID": "proj_test",
        "MACRO_API_TOKEN_PRIVATE_SECRET_KEY": "macro-api-token-private-key-dev",
        "MCP_CREDENTIALS_KEY_SECRET_NAME": "mcp-credentials-key-dev",
        "MACRO_API_TOKEN_ISSUER": "macro",
        "AGENT_SESSION_CHANGES_BUCKET": "agent-session-changes",
        "GITHUB_PULL_REQUEST_PATCH_BUCKET": "github-pull-request-patches",
        "GITHUB_SYNC_APP_CLIENT_ID": "github-sync-app",
        "GITHUB_SYNC_APP_PEM_SECRET_KEY": "github-sync-app-pem-dev"
    })
}

struct SecretsByName;

impl secretsmanager_client::SecretManager for SecretsByName {
    type Err = std::io::Error;

    async fn get_secret_value<T: AsRef<str> + Send>(
        &self,
        secret_name: T,
    ) -> Result<std::sync::Arc<str>, Self::Err> {
        match secret_name.as_ref() {
            "authentication-service-internal-api-key-dev" => Ok("internal-key".into()),
            "macro-api-token-private-key-dev"
            | "mcp-credentials-key-dev"
            | "github-sync-app-pem-dev" => Ok("other-secret".into()),
            other => Err(std::io::Error::other(format!("no secret named {other}"))),
        }
    }
}

#[tokio::test]
async fn deployed_harness_settles_with_the_authentication_key_not_its_secret_name() {
    use ai_billing::composition::SettlementRoute;

    let mut values = deployed_config_values();
    values["AUTHENTICATION_SERVICE_SECRET_KEY"] =
        json!("authentication-service-internal-api-key-dev");
    let mut config: Config = serde_json::from_value(values).unwrap();
    config.enable_ai_usage_billing = ai_billing::AiUsageBilling::Enabled;
    let environment = config.environment;
    let config = config
        .resolve_remote_secrets(environment, &SecretsByName)
        .await
        .unwrap();
    assert_eq!(
        config.authentication_service_secret_key.as_str(),
        Some("internal-key")
    );
    assert!(matches!(
        config.settlement_route().unwrap(),
        SettlementRoute::AuthService(_)
    ));
}

#[tokio::test]
async fn deployed_harness_refuses_a_value_that_is_not_a_readable_secret_name() {
    for value in ["internal-key", ""] {
        let mut values = deployed_config_values();
        values["AUTHENTICATION_SERVICE_SECRET_KEY"] = json!(value);
        let config: Config = serde_json::from_value(values).unwrap();
        let environment = config.environment;
        assert!(
            config
                .resolve_remote_secrets(environment, &SecretsByName)
                .await
                .is_err(),
            "{value:?} must fail startup"
        );
    }
}

#[tokio::test]
async fn deployed_harness_without_the_key_skips_the_lookup_and_refuses_billing() {
    let mut config: Config = serde_json::from_value(deployed_config_values()).unwrap();
    config.enable_ai_usage_billing = ai_billing::AiUsageBilling::Enabled;
    let environment = config.environment;
    let config = config
        .resolve_remote_secrets(environment, &SecretsByName)
        .await
        .unwrap();
    assert_eq!(config.authentication_service_secret_key.as_str(), None);
    assert!(config.settlement_route().is_err());
}
