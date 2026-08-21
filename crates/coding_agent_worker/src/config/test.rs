use super::*;

const EXAMPLE: &str = include_str!("../../config.example.toml");

#[test]
fn the_example_config_parses() {
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert_eq!(config.harness.command, "opencode");
    assert_eq!(config.harness.args, vec!["acp"]);
    assert_eq!(config.server.port, 8790);
    assert_eq!(config.macro_api.bot_scope, "user");
    assert_eq!(config.server.signing_secret, None);
    assert_eq!(
        config.server.public_url,
        "http://sdk-webhook-relay:8787/macro-events"
    );
}

#[test]
fn unknown_fields_are_rejected() {
    let with_typo = EXAMPLE.replace("repo_url", "repo_uri");
    assert!(toml::from_str::<Config>(&with_typo).is_err());
}

#[test]
fn args_and_scope_default() {
    let trimmed = EXAMPLE
        .replace("args = [\"acp\"]\n", "")
        .replace("bot_scope = \"user\"\n", "");
    let config: Config = toml::from_str(&trimmed).expect("args and scope are optional");
    assert!(config.harness.args.is_empty());
    assert_eq!(config.macro_api.bot_scope, "user");
}

#[test]
fn the_gateway_url_is_the_api_base_with_a_websocket_scheme() {
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert_eq!(
        config.macro_api.gateway_url(),
        "ws://localhost:50009/agent-harness/runtime/ws",
    );

    let secure = MacroApi {
        api_url: "https://agent-harness.macro.com/".to_owned(),
        storage_url: "https://cloud-storage.macro.com".to_owned(),
        owner_user_id: "macro|owner@example.com".to_owned(),
        bot_token: "mbot_x".to_owned(),
        bot_scope: "user".to_owned(),
    };
    assert_eq!(
        secure.gateway_url(),
        "wss://agent-harness.macro.com/runtime/ws",
    );
}
