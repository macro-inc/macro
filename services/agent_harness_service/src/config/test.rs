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

#[tokio::test]
async fn authentication_key_resolves_before_linked_github_client_is_built() {
    let config: Config = serde_json::from_value(serde_json::json!({
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
    }))
    .unwrap();

    let config = config
        .resolve_remote_secrets(Environment::Develop, &TestSecretManager)
        .await
        .unwrap();
    assert_eq!(
        config.authentication_service_secret_key.as_str(),
        Some("resolved-auth-key")
    );
    assert!(config.auth_service_client().unwrap().is_some());
}
