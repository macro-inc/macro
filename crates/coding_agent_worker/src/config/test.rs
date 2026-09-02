use super::*;

const EXAMPLE: &str = include_str!("../../config.example.toml");

#[test]
fn the_example_config_parses() {
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert_eq!(config.harness.command, "opencode");
    assert_eq!(config.harness.args, vec!["acp"]);
    assert_eq!(config.identity.name.as_deref(), Some("erics-macbook"));
    assert_eq!(config.identity.scope, IdentityScope::Private);
}

#[test]
fn leftover_server_section_is_ignored() {
    let with_server =
        format!("{EXAMPLE}\n[server]\nport = 8790\npublic_url = \"http://example/macro-events\"\n");
    toml::from_str::<Config>(&with_server).expect("legacy server section still parses");
}

#[test]
fn unknown_fields_are_rejected() {
    let with_typo = EXAMPLE.replace("repo_url", "repo_uri");
    assert!(toml::from_str::<Config>(&with_typo).is_err());
}

#[test]
fn removed_credential_fields_fail_loudly() {
    // Pre-pairing configs carried bot credentials; a stale one should fail
    // with a parse error pointing at the removed key rather than serve with
    // half an identity.
    let stale = EXAMPLE.replace(
        "storage_url = \"http://localhost:50009/dss\"",
        "storage_url = \"http://localhost:50009/dss\"\nbot_token = \"mbot_x\"",
    );
    assert!(toml::from_str::<Config>(&stale).is_err());
}

#[test]
fn identity_args_and_web_url_default() {
    let trimmed = EXAMPLE
        .replace("args = [\"acp\"]\n", "")
        .replace("[identity]\n", "")
        .replace("name = \"erics-macbook\"\n", "")
        .replace("scope = \"private\"\n", "")
        .replace("web_url = \"http://localhost:3000/app\"\n", "");
    let config: Config = toml::from_str(&trimmed).expect("identity, args, web_url are optional");
    assert!(config.harness.args.is_empty());
    assert_eq!(config.identity.name, None);
    assert_eq!(config.identity.scope, IdentityScope::Private);
    assert_eq!(config.macro_api.web_url, "https://macro.com/app");
}

#[test]
fn identity_scope_accepts_team() {
    let team = EXAMPLE.replace("scope = \"private\"", "scope = \"team\"");
    let config: Config = toml::from_str(&team).expect("team scope parses");
    assert_eq!(config.identity.scope, IdentityScope::Team);

    let bogus = EXAMPLE.replace("scope = \"private\"", "scope = \"public\"");
    assert!(toml::from_str::<Config>(&bogus).is_err());
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
        storage_url: "https://gateway.macro.com/dss".to_owned(),
        web_url: "https://macro.com/app/".to_owned(),
    };
    assert_eq!(
        secure.gateway_url(),
        "wss://agent-harness.macro.com/runtime/ws",
    );
    assert_eq!(
        secure.pairing_approval_url("KX7M-4QHD"),
        "https://macro.com/app/settings/harness?pair=KX7M-4QHD",
    );
}
