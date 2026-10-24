use super::*;

#[test]
fn public_mcp_client_callback_is_in_the_slack_manifest() {
    let manifest: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../crates/mcp_client/src/domain/provider_registry/slack/manifest.json"
    ))
    .unwrap();
    let registered: Vec<&str> = manifest["oauth_config"]["redirect_urls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|url| url.as_str().unwrap())
        .collect();

    for environment in [Environment::Production, Environment::Develop] {
        let callback = format!(
            "{}/mcp/servers/auth/callback",
            macro_service_urls::CognitionPublicUrl::default_for_environment(environment)
        );
        assert!(
            registered.contains(&callback.as_str()),
            "{environment:?}: {callback} is not registered in the Slack manifest"
        );
    }
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
            "SYNC_SERVICE_AUTH_KEY"
            | "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY"
            | "MCP_CREDENTIALS_KEY_SECRET_NAME" => Ok("other-secret".into()),
            other => Err(std::io::Error::other(format!("no secret named {other}"))),
        }
    }
}

#[tokio::test]
async fn deployed_cognition_presents_the_authentication_key_not_its_secret_name() {
    let mut config = Config::new_empty_for_test();
    config.environment = Environment::Develop;
    config.authentication_service_secret_key = LocalOrRemoteSecret::Local(
        AuthenticationServiceSecretKey::Comptime("authentication-service-internal-api-key-dev"),
    );
    let config = config
        .resolve_remote_secrets(Environment::Develop, &SecretsByName)
        .await
        .unwrap();
    assert_eq!(
        config.authentication_service_secret_key.as_ref(),
        "internal-key"
    );

    for value in ["internal-key", ""] {
        let mut config = Config::new_empty_for_test();
        config.environment = Environment::Develop;
        config.authentication_service_secret_key =
            LocalOrRemoteSecret::Local(AuthenticationServiceSecretKey::Comptime(value));
        assert!(
            config
                .resolve_remote_secrets(Environment::Develop, &SecretsByName)
                .await
                .is_err(),
            "{value:?} must fail startup"
        );
    }
}
