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
