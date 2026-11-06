use super::Config;

#[test]
fn speech_disable_requires_explicit_empty_credentials() {
    let mut values = serde_json::json!({
        "ENVIRONMENT": "local",
        "HARNESS_BOT_ID": "00000000-0000-0000-0000-000000000001",
        "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS": 500,
        "AI_USAGE_INCLUDED_ALLOWANCE_CENTS": 1500,
        "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS": 15000,
        "AI_USAGE_OVERAGE_MARKUP_PERCENT": 25,
        "LIVEKIT_API_KEY": "",
        "LIVEKIT_API_SECRET": ""
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
    let config: Config = serde_json::from_value(values.clone()).unwrap();
    assert!(config.livekit_api_key.is_empty());
    assert!(config.livekit_api_secret.is_empty());
    for key in ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] {
        let mut incomplete = values.clone();
        incomplete.as_object_mut().unwrap().remove(key);
        let error = serde_json::from_value::<Config>(incomplete).err().unwrap();
        assert!(error.to_string().contains(key), "{error}");
    }
}
